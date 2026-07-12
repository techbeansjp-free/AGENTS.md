import os
import fnmatch


def is_binary(file_path):
    with open(file_path, "rb") as file:
        return b"\0" in file.read(1024)


def read_file_contents(file_path):
    encodings = ["utf-8", "shift_jis"]
    for encoding in encodings:
        try:
            with open(file_path, "r", encoding=encoding) as file:
                print(f"ファイルを読み込み中: {file_path}")
                return file.read()
        except UnicodeDecodeError:
            pass
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
            # */memo/ → memo, memo/ → memo
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


def generate_project_summary(project_dir):
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

    file_contents_section = "\n## ファイル内容\n\n"

    def traverse_directory(root, level):
        nonlocal summary, file_contents_section
        indent = "  " * level
        relative_path = os.path.relpath(root, project_dir)
        if not is_ignored(
            root, project_dir, gitignore_patterns,
            summaryignore_patterns, additional_ignore_patterns
        ):
            summary += f"{indent}- {os.path.basename(root)}/\n"

            subindent = "  " * (level + 1)
            for item in os.listdir(root):
                item_path = os.path.join(root, item)
                if os.path.isdir(item_path):
                    if not is_ignored(
                        item_path, project_dir, gitignore_patterns,
                        summaryignore_patterns, additional_ignore_patterns
                    ):
                        traverse_directory(item_path, level + 1)
                else:
                    if not is_ignored(
                        item_path, project_dir, gitignore_patterns,
                        summaryignore_patterns, additional_ignore_patterns
                    ):
                        if not is_binary(item_path):
                            summary += f"{subindent}- {item}\n"
                            content = read_file_contents(item_path)
                            if content.strip():
                                relative_file_path = os.path.relpath(
                                    item_path, project_dir
                                )
                                file_contents_section += (
                                    f"### {relative_file_path}\n\n"
                                )
                                file_contents_section += (
                                    f"```\n{content}\n```\n\n"
                                )
                        else:
                            summary += f"{subindent}- {item} (バイナリファイル)\n"

    traverse_directory(project_dir, 0)

    summary_file_path = f"{project_name}_project_summary.txt"
    with open(summary_file_path, "w", encoding="utf-8") as file:
        file.write(summary + file_contents_section)


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


def find_summaryignore_upward(start_dir):
    """start_dir から親ディレクトリへ遡り、各階層で
    <dir>/.summary/.summaryignore（正準の配置場所）または <dir>/.summaryignore
    を探す。project_dir がサブディレクトリ（例: .workflow）でも、
    プロジェクトルートの .summary/.summaryignore を発見できるようにする。"""
    dir_ = os.path.abspath(start_dir)
    while True:
        for candidate in (
            os.path.join(dir_, ".summary", ".summaryignore"),
            os.path.join(dir_, ".summaryignore"),
        ):
            if os.path.isfile(candidate):
                return candidate
        parent = os.path.dirname(dir_)
        if parent == dir_:
            break
        dir_ = parent
    return None


def read_summaryignore(project_dir):
    path = find_summaryignore_upward(project_dir)
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
        "プロジェクトディレクトリパスを入力してください (現在のディレクトリの場合は空白のままにします):"
    )
    if not project_directory:
        project_directory = os.getcwd()
    generate_project_summary(project_directory)
