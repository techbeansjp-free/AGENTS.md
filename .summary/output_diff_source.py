import os
import fnmatch
import subprocess


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
    # 末尾のスラッシュを保持（ディレクトリの場合）
    return pattern


def is_ignored(path, project_dir, gitignore_patterns,
               summaryignore_patterns, additional_ignore_patterns):
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
            if (fnmatch.fnmatch(relative_path + '/', pattern) or
                    fnmatch.fnmatch(relative_path + '/', '*/' + pattern)):
                return True
        # グロブパターンの処理
        elif '*' in pattern:
            if fnmatch.fnmatch(relative_path, pattern):
                return True
            if fnmatch.fnmatch(relative_path, '*/' + pattern):
                return True
        # 通常のパターンの処理
        else:
            if (relative_path == pattern or
                    relative_path.endswith('/' + pattern)):
                return True

    return False


def get_changed_files(project_dir, base_branch='develop'):
    git_root = find_git_root(project_dir)
    if not git_root:
        print("エラー: .gitディレクトリが見つかりません。")
        return []

    try:
        # base_branchとの差分を取得
        diff_result = subprocess.run(
            ['git', 'diff', '--name-only', base_branch],
            cwd=git_root, capture_output=True, text=True, check=True
        )
        diff_files = diff_result.stdout.splitlines()
        if diff_result.returncode != 0:
            print(f"エラー: 差分取得に失敗しました。詳細: {diff_result.stderr}")
            return []

        # ステージングされていない新規ファイルのリストを取得
        untracked_result = subprocess.run(
            ['git', 'ls-files', '--others', '--exclude-standard'],
            cwd=git_root, capture_output=True, text=True, check=True
        )
        untracked_files = untracked_result.stdout.splitlines()
        if untracked_result.returncode != 0:
            msg = f"エラー: 新規ファイル取得に失敗しました。詳細: {untracked_result.stderr}"
            print(msg)
            return []

        # すべての変更ファイルを結合し、重複を取り除く
        all_files = list(set(diff_files + untracked_files))
        return [os.path.join(git_root, file) for file in all_files]
    except subprocess.CalledProcessError:
        print(f"エラー: '{base_branch}' ブランチとの差分を取得できませんでした。")
        return []


def generate_project_summary(project_dir, base_branch='develop'):
    project_name = os.path.basename(project_dir)
    summary = f"# {project_name}\n\n## ディレクトリ構造\n\n"

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
            f"{project_name}_project_summary.txt",
            ".git/",
            "*.lock",
            "*lock*",
        ]
    ]

    changed_files = get_changed_files(project_dir, base_branch)

    file_contents_section = "\n## ファイル内容\n\n"
    processed_files_count = 0

    for file_path in changed_files:
        if os.path.exists(file_path) and not is_binary(file_path):
            relative_path = os.path.relpath(file_path, project_dir)
            if not is_ignored(
                relative_path,
                project_dir,
                gitignore_patterns,
                summaryignore_patterns,
                additional_ignore_patterns
            ):
                content = read_file_contents(file_path)
                if content.strip():
                    file_contents_section += (
                        f"### {relative_path}\n\n```\n{content}\n```\n\n"
                    )
                    processed_files_count += 1

    def traverse_directory(root, level):
        nonlocal summary
        indent = "  " * level
        relative_path = os.path.relpath(root, project_dir)
        if not is_ignored(relative_path, project_dir, gitignore_patterns,
                          summaryignore_patterns, additional_ignore_patterns):
            summary += f"{indent}- {os.path.basename(root)}/\n"

            subindent = "  " * (level + 1)
            for item in sorted(os.listdir(root)):
                item_path = os.path.join(root, item)
                relative_item_path = os.path.relpath(item_path, project_dir)
                if os.path.isdir(item_path):
                    if not is_ignored(
                        relative_item_path,
                        project_dir,
                        gitignore_patterns,
                        summaryignore_patterns,
                        additional_ignore_patterns
                    ):
                        traverse_directory(item_path, level + 1)
                else:
                    if not is_ignored(
                        relative_item_path,
                        project_dir,
                        gitignore_patterns,
                        summaryignore_patterns,
                        additional_ignore_patterns
                    ):
                        summary += f"{subindent}- {item}\n"

    traverse_directory(project_dir, 0)

    # diff情報を取得
    git_root = find_git_root(project_dir)
    if not git_root:
        print("エラー: .gitディレクトリが見つかりません。")
        return []

    try:
        # git diff base_branch の情報を取得
        diff_result = subprocess.run(
            ['git', 'diff', '--name-status', base_branch],
            cwd=git_root, capture_output=True, text=True, check=True
        )
        diff_lines = diff_result.stdout.splitlines()

        # diff情報をまとめる
        diff_section = "\n## 差分\n\n"
        for line in diff_lines:
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            status = parts[0]
            file_path = parts[1]
            relative_path = os.path.relpath(file_path, project_dir)

            if not is_ignored(
                relative_path,
                project_dir,
                gitignore_patterns,
                summaryignore_patterns,
                additional_ignore_patterns
            ):
                # git diff base_branch の結果を取得
                try:
                    diff_output = subprocess.run(
                        ['git', 'diff', base_branch, '--', file_path],
                        cwd=git_root, capture_output=True, text=True,
                        check=True
                    )
                    if diff_output.stdout.strip():
                        diff_section += (
                            "### {} ({})\n```diff\n{}```\n\n".format(
                                relative_path,
                                status,
                                diff_output.stdout.replace('`', '\\`')
                            )
                        )
                except subprocess.CalledProcessError as e:
                    msg = (
                        f"エラー: '{base_branch}' ブランチとの差分を"
                        f"取得できませんでした。詳細: {e.stderr}"
                    )
                    print(msg)
                    continue

    except subprocess.CalledProcessError as e:
        print(f"エラー: 差分取得に失敗しました。詳細: {e.stderr}")
        diff_section = "\n## 差分\n\n*差分情報の取得に失敗しました*\n"

    summary_file_path = f"{project_name}_diff_project_summary.txt"
    with open(summary_file_path, "w", encoding="utf-8") as file:
        file.write(summary + file_contents_section + diff_section)

    print(f"処理されたファイルの数: {processed_files_count}")


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
            return [line.strip() for line in file
                    if line.strip() and not line.startswith("#")]
    return []


def read_summaryignore(project_dir):
    path = find_file_upward(project_dir, ".summaryignore")
    if path and os.path.exists(path):
        with open(path, "r") as file:
            return [
                line.strip()
                for line in file
                if (
                    line.strip() and
                    not line.strip().startswith("//") and
                    not line.strip().startswith("#")
                )
            ]
    return []


if __name__ == "__main__":
    project_directory = input(
        "プロジェクトディレクトリパスを入力してください "
        "(現在のディレクトリの場合は空白のままにします):"
    )
    if not project_directory:
        project_directory = os.getcwd()

    base_branch = input(
        "比較するベースブランチを入力してください (デフォルトは 'develop'):"
    )
    if not base_branch:
        base_branch = 'develop'

    generate_project_summary(project_directory, base_branch)

    print("処理が完了しました。")
