#!/usr/bin/env python3
"""Install Linux desktop identity for an explicit native binary or profile wrapper.

Example: python tools/install-linux-desktop.py --destination /tmp/cx/data \
    --launcher /absolute/path/to/validated/native/binary
Use --launcher-mode wrapper for a profile-preserving launcher whose final
native exec sets argv[0] to Coxinha. Installation never edits or runs a launcher.
"""
import argparse
import json
import os
from pathlib import Path
import stat

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = 'Coxinha'


def exec_argument(value):
    """Quote one Exec argument, including the desktop string escape layer."""
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Control characters are not supported in desktop paths')
    # Gio checks the first Exec token before expanding %% codes. The desktop
    # entry uses /usr/bin/env so hostile path characters occur in arguments.
    quoted = ''.join('\\' + c if c in '\\"`$' else c for c in value)
    return '"' + quoted.replace('\\', '\\\\').replace('%', '%%') + '"'


def clean_path(value):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Paths must be absolute and contain no parent traversal')
    exec_argument(str(path))
    return path


def safe_parents(path):
    for parent in reversed(path.parents):
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise FileExistsError(f'Unsafe destination parent: {parent}')


def install(destination, launcher, source=ROOT, ort_library=None,
            launcher_mode='native', launcher_args=()):
    destination, launcher = clean_path(destination), clean_path(launcher)
    if launcher_mode not in ('native', 'wrapper'):
        raise ValueError('Launcher mode must be native or wrapper')
    launcher_args = tuple(launcher_args)
    for argument in launcher_args:
        exec_argument(argument)
    if not launcher.is_file() or not os.access(launcher, os.X_OK):
        raise ValueError('Launcher must be an existing executable file')
    with launcher.open('rb') as stream:
        header = stream.read(4)
    if launcher_mode == 'native' and header != b'\x7fELF':
        raise ValueError('Native mode requires ELF; select wrapper mode explicitly for scripts')
    if launcher_mode == 'wrapper' and not header.startswith(b'#!'):
        raise ValueError('Wrapper mode requires an executable script with a shebang')
    if launcher_mode == 'wrapper' and ort_library is not None:
        raise ValueError('Wrapper mode preserves wrapper-owned ORT and profile settings')
    config = json.loads((source / 'src-tauri/tauri.conf.json').read_text())
    if (config['productName'] != IDENTITY or config.get('mainBinaryName') != IDENTITY
            or config['app'].get('enableGTKAppId') is not False):
        raise ValueError('Tauri desktop identity configuration does not match installer')
    environment = ''
    if ort_library is not None:
        ort_library = clean_path(ort_library)
        if not ort_library.is_file():
            raise ValueError('ORT library must be an existing absolute file')
        environment = exec_argument(f'ORT_DYLIB_PATH={ort_library}') + ' '
    entry = destination / 'applications' / f'{IDENTITY}.desktop'
    link = destination / 'coxinha' / IDENTITY if launcher_mode == 'native' else None
    executable = link if link is not None else launcher
    if '=' in str(executable):
        raise ValueError('Desktop Entry executable paths cannot contain equals signs')
    arguments = ' '.join(exec_argument(value) for value in [str(executable), *launcher_args])
    desktop = ('[Desktop Entry]\nType=Application\nName=Coxinha\n'
               'Comment=Your local second brain with AI\n'
               f'Exec=/usr/bin/env -- {environment}{arguments}\nIcon={IDENTITY}\n'
               f'StartupWMClass={IDENTITY}\nTerminal=false\n'
               'Categories=Office;\nDBusActivatable=false\n').encode()
    files = {entry: desktop}
    for size, asset in [('32x32', '32x32.png'), ('128x128', '128x128.png'),
                        ('256x256', '128x128@2x.png')]:
        files[destination / 'icons/hicolor' / size / 'apps' / f'{IDENTITY}.png'] = (
            source / 'src-tauri/icons' / asset).read_bytes()
    # Preflight every target before creating anything. Unlike files are preserved.
    for path, content in files.items():
        safe_parents(path)
        if path.is_symlink() or (path.exists() and
                (not path.is_file() or path.read_bytes() != content)):
            raise FileExistsError(f'Refusing unlike existing file: {path}')
    if link is not None:
        safe_parents(link)
        if os.path.lexists(link) and (not link.is_symlink() or os.readlink(link) != str(launcher)):
            raise FileExistsError(f'Refusing unlike existing launcher: {link}')
    created = []
    try:
        if link is not None and not os.path.lexists(link):
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(launcher)
            created.append(link)
        for path, content in files.items():
            if path.exists():
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as stream:
                created.append(path)
                stream.write(content)
            path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
    except Exception:
        for path in reversed(created):
            path.unlink()
        raise
    return {'desktopEntry': str(entry), 'launcher': str(executable),
            'nativeTarget': str(launcher) if link is not None else None,
            'launcherMode': launcher_mode, 'launcherArgs': list(launcher_args),
            'identity': IDENTITY,
            'created': [str(path) for path in created]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True, help='Explicit XDG data directory')
    parser.add_argument('--launcher', required=True, help='Validated native ELF binary or explicit profile wrapper')
    parser.add_argument('--ort-library', help='Optional explicit public ONNX Runtime library')
    parser.add_argument('--launcher-mode', choices=['native', 'wrapper'], default='native')
    parser.add_argument('--launcher-arg', action='append', default=[],
                        help='One literal argument, repeatable; use = for leading dashes')
    args = parser.parse_args()
    try:
        result = install(args.destination, args.launcher, ort_library=args.ort_library,
                         launcher_mode=args.launcher_mode, launcher_args=args.launcher_arg)
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
