import os
import fnmatch
import subprocess
import json


def find_git_root(path):
    while path != '/':
        if os.path.exists(os.path.join(path, '.git')):
            return path
        path = os.path.dirname(path)
    return None


def is_binary(file_path):
    try:
        with open(file_path, "rb") as file:
            return b"\0" in file.read(1024)
    except IOError:
        print(f"ファイルを開けません: {file_path}")
        return False


def read_file_contents(file_path):
    encodings = ["utf-8", "shift_jis", "euc-jp", "iso2022_jp"]
    for encoding in encodings:
        try:
            with open(file_path, "r", encoding=encoding) as file:
                content = file.read()
                return content
        except UnicodeDecodeError:
            continue
    print(f"ファイルを読み込めません: {file_path}")
    return ""


def normalize_pattern(pattern):
    # 先頭のスラッシュを削除
    if pattern.startswith('/'):
        pattern = pattern[1:]
    # 末尾のスラッシュはディレクトリ指定として保持
    return pattern


def is_ignored(path, project_dir, gitignore_patterns, summaryignore_patterns,
               additional_ignore_patterns):
    relative_path = os.path.relpath(path, project_dir)
    all_patterns = (gitignore_patterns + summaryignore_patterns +
                    additional_ignore_patterns)

    for pattern in all_patterns:
        # ディレクトリパターンの処理（例: memo/, */memo/）
        if pattern.endswith('/'):
            # 末尾の/を除いた最後のセグメントをディレクトリ名として使用
            dir_name = pattern.rstrip('/').split('/')[-1]
            path_parts = relative_path.split(os.sep)
            if dir_name in path_parts:
                return True
            if (
                fnmatch.fnmatch(relative_path + '/', pattern)
                or fnmatch.fnmatch(relative_path + '/', '*/' + pattern)
            ):
                return True
        # グロブパターンの処理
        elif '*' in pattern:
            if (
                fnmatch.fnmatch(relative_path, pattern)
                or fnmatch.fnmatch(relative_path, '*/' + pattern)
            ):
                return True
        # 通常のパターンの処理
        else:
            if (
                relative_path == pattern
                or relative_path.endswith('/' + pattern)
            ):
                return True

    return False


def find_file_upward(start_dir, filename):
    """start_dir から親ディレクトリへ向かって filename を探し、見つかったパスを返す。"""
    dir_ = os.path.abspath(start_dir)
    while dir_:
        path = os.path.join(dir_, filename)
        if os.path.isfile(path):
            return path
        parent = os.path.dirname(dir_)
        if parent == dir_:
            break
        dir_ = parent
    return None


def read_gitignore(project_dir):
    path = find_file_upward(project_dir, ".gitignore")
    if path and os.path.exists(path):
        with open(path, "r") as file:
            return [
                line.strip() for line in file
                if line.strip() and not line.startswith("#")
            ]
    return []


def read_summaryignore(project_dir):
    path = find_file_upward(project_dir, ".summaryignore")
    if path and os.path.exists(path):
        with open(path, "r") as file:
            return [
                line.strip() for line in file
                if (
                    line.strip()
                    and not line.strip().startswith("//")
                    and not line.strip().startswith("#")
                )
            ]
    return []


def get_pr_changed_files(pr_number, project_dir):
    try:
        result = subprocess.run(
            [
                'gh', 'pr', 'view', str(pr_number), '--json',
                'title,files'
            ],
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=True
        )
        data = json.loads(result.stdout)
        return data.get("files", []), data.get("title", "")
    except subprocess.CalledProcessError as e:
        print(
            f"エラー: PR情報の取得に失敗しました。詳細: {e.stderr}"
        )
        return [], ""


def get_pr_diff(pr_number, project_dir):
    try:
        diff_result = subprocess.run(
            ['gh', 'pr', 'diff', str(pr_number)],
            cwd=project_dir,
            capture_output=True,
            text=True,
            check=True
        )
        return diff_result.stdout
    except subprocess.CalledProcessError as e:
        print(
            f"エラー: PRのdiff情報取得に失敗しました。詳細: {e.stderr}"
        )
        return ""


def generate_pr_project_summary(project_dir, pr_number):
    project_name = os.path.basename(project_dir)
    pr_files, pr_title = get_pr_changed_files(pr_number, project_dir)
    summary = f"# {project_name} PR#{pr_number}: {pr_title}\n\n"
    summary += "## ディレクトリ構造\n\n"

    gitignore_patterns = [
        normalize_pattern(p) for p in read_gitignore(project_dir)
    ]
    summaryignore_patterns = [
        normalize_pattern(p) for p in read_summaryignore(project_dir)
    ]
    additional_ignore_patterns = [
        normalize_pattern(p) for p in [
            "generate_project_summary.py",
            ".summaryignore",
            f"{project_name}_PR{pr_number}_project_summary.txt",
            ".git/",
            "*.lock",
            "*lock*",
        ]
    ]

    file_contents_section = "\n## ファイル内容\n\n"
    processed_files_count = 0

    for file_info in pr_files:
        file_path = file_info.get("path", "")
        full_path = os.path.join(project_dir, file_path)
        if os.path.exists(full_path) and not is_binary(full_path):
            if not is_ignored(
                file_path, project_dir, gitignore_patterns,
                summaryignore_patterns, additional_ignore_patterns
            ):
                content = read_file_contents(full_path)
                if content.strip():
                    file_contents_section += (
                        f"### {file_path}\n\n```\n{content}\n```\n\n"
                    )
                    processed_files_count += 1

    def traverse_directory(root, level):
        nonlocal summary
        indent = "  " * level
        relative_path = os.path.relpath(root, project_dir)
        if not is_ignored(
            relative_path, project_dir, gitignore_patterns,
            summaryignore_patterns, additional_ignore_patterns
        ):
            summary += f"{indent}- {os.path.basename(root)}/\n"
            subindent = "  " * (level + 1)
            for item in sorted(os.listdir(root)):
                item_path = os.path.join(root, item)
                relative_item_path = os.path.relpath(item_path, project_dir)
                if os.path.isdir(item_path):
                    if not is_ignored(
                        relative_item_path, project_dir, gitignore_patterns,
                        summaryignore_patterns, additional_ignore_patterns
                    ):
                        traverse_directory(item_path, level + 1)
                else:
                    if not is_ignored(
                        relative_item_path, project_dir, gitignore_patterns,
                        summaryignore_patterns, additional_ignore_patterns
                    ):
                        summary += f"{subindent}- {item}\n"

    traverse_directory(project_dir, 0)

    diff_section = "\n## 差分\n\n"
    pr_diff = get_pr_diff(pr_number, project_dir)
    if pr_diff.strip():
        safe_diff = pr_diff.replace('`', '\\`')
        diff_section += f"```diff\n{safe_diff}\n```\n"
    else:
        diff_section += "*差分情報の取得に失敗しました*\n"

    summary_file_path = (
        f"{project_name}_PR{pr_number}_project_summary.txt"
    )
    with open(summary_file_path, "w", encoding="utf-8") as file:
        file.write(summary + file_contents_section + diff_section)

    print(f"処理されたファイルの数: {processed_files_count}")
    print(f"サマリファイルを生成しました: {summary_file_path}")


if __name__ == "__main__":
    project_directory = input(
        "プロジェクトディレクトリパスを入力してください "
        "(現在のディレクトリの場合は空白のままにします):"
    )
    if not project_directory:
        project_directory = os.getcwd()

    pr_number = input("対象のPR番号を入力してください:").strip()
    if not pr_number:
        print("PR番号が入力されていません。")
        exit(1)

    generate_pr_project_summary(project_directory, pr_number)
    print("処理が完了しました。")
