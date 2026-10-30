#!/usr/bin/env python3
"""Temporary-only Linux installer contracts. No product executable is started."""
import importlib.util
import fcntl
import hashlib
import time
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install-linux-desktop.py'))
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.destination = self.root / 'data'
        self.launcher = Path(shutil.which('true')).resolve()

    def install(self):
        return installer.install(self.destination, self.launcher)

    def test_identity_assets_validation_and_idempotence(self):
        result = self.install()
        entry = Path(result['desktopEntry'])
        subprocess.run(['desktop-file-validate', str(entry)], check=True)
        self.assertEqual(entry.stem, result['identity'])
        text = entry.read_text()
        self.assertIn('Icon=Coxinha\nStartupWMClass=Coxinha\n', text)
        self.assertEqual(Path(result['launcher']).resolve(), self.launcher)
        asset = self.destination / 'icons/hicolor/128x128/apps/Coxinha.png'
        self.assertEqual(asset.read_bytes(), (installer.ROOT / 'src-tauri/icons/128x128.png').read_bytes())
        before = {str(p): p.lstat().st_mtime_ns for p in self.destination.rglob('*')}
        self.assertEqual(self.install()['created'], [])
        self.assertEqual(before, {str(p): p.lstat().st_mtime_ns for p in self.destination.rglob('*')})

    def test_unlike_file_refuses_entire_install(self):
        icon = self.destination / 'icons/hicolor/128x128/apps/Coxinha.png'
        icon.parent.mkdir(parents=True)
        icon.write_bytes(b'keep me')
        with self.assertRaises(FileExistsError): self.install()
        self.assertEqual(icon.read_bytes(), b'keep me')
        self.assertFalse((self.destination / 'applications').exists())
        self.assertFalse((self.destination / 'coxinha').exists())

    def test_symlink_parents_and_targets_refused(self):
        outside = self.root / 'outside'; outside.mkdir()
        self.destination.symlink_to(outside)
        with self.assertRaises(FileExistsError): self.install()
        self.assertEqual(list(outside.iterdir()), [])
        self.destination.unlink(); self.destination.mkdir()
        applications = self.destination / 'applications'; applications.mkdir()
        (applications / 'Coxinha.desktop').symlink_to(outside / 'missing')
        with self.assertRaises(FileExistsError): self.install()
        self.assertFalse((outside / 'missing').exists())

    def test_existing_launcher_not_replaced(self):
        link = self.destination / 'coxinha/Coxinha'; link.parent.mkdir(parents=True)
        link.symlink_to('/different/native')
        with self.assertRaises(FileExistsError): self.install()
        self.assertEqual(os.readlink(link), '/different/native')
        self.assertFalse((self.destination / 'applications').exists())

    def test_invalid_inputs_have_no_effect(self):
        for value in ['relative', str(self.root / 'bad\npath'), str(self.root / 'x/../y'), str(self.root / 'a=b')]:
            with self.assertRaises(ValueError): installer.install(value, self.launcher)
        script = self.root / 'script'; script.write_text('#!/bin/sh\nexit 0\n');script.chmod(0o755)
        with self.assertRaises(ValueError): installer.install(self.destination, script)
        self.assertFalse(self.destination.exists())

    def test_explicit_ort_and_missing_library_fail_before_mutation(self):
        ort = self.root / 'ORT $path %f.so'; ort.write_bytes(b'public fixture')
        result = installer.install(self.destination, self.launcher, ort_library=ort)
        subprocess.run(['desktop-file-validate', result['desktopEntry']], check=True)
        self.assertIn('ORT_DYLIB_PATH=', Path(result['desktopEntry']).read_text())
        missing_dest = self.root / 'missing-data'
        with self.assertRaises(ValueError):
            installer.install(missing_dest, self.launcher, ort_library=self.root / 'missing')
        self.assertFalse(missing_dest.exists())

    def test_mismatched_config_and_implicit_install_refused(self):
        source = self.root / 'source'
        (source / 'src-tauri').mkdir(parents=True)
        (source / 'src-tauri/tauri.conf.json').write_text(json.dumps({
            'productName': 'Coxinha', 'app': {'enableGTKAppId': True}}))
        with self.assertRaises(ValueError):
            installer.install(self.destination, self.launcher, source=source)
        self.assertFalse(self.destination.exists())
        result = subprocess.run([sys.executable, str(Path(installer.__file__))],
                                cwd=self.root, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.destination.exists())

    def test_exec_roundtrip_through_real_gio_with_hostile_paths(self):
        # Compile a disposable argv recorder, then let Gio parse and launch Exec.
        # No shell is involved at either boundary; metacharacters stay literal.
        hostile = self.root / 'space " quote \\ slash $d `touch PWNED` ; & %f (x)'
        hostile.mkdir(); self.destination = hostile / 'data'
        cfile = self.root / 'record.c'; self.launcher = hostile / 'native = ; $x %U'
        output = self.root / 'argv'
        cfile.write_text('#include <stdio.h>\n#include <stdlib.h>\nint main(int argc,char**argv){FILE*f=fopen(getenv("CX_ARGV"),"w");fputs(argv[0],f);fputc(10,f);fputs(getenv("ORT_DYLIB_PATH"),f);fclose(f);return 0;}\n')
        subprocess.run(['cc', str(cfile), '-o', str(self.launcher)], check=True)
        ort = hostile / 'ORT ; $x %F.so'; ort.write_bytes(b'public fixture')
        result = installer.install(self.destination, self.launcher, ort_library=ort)
        entry = Path(result['desktopEntry'])
        subprocess.run(['desktop-file-validate', str(entry)], check=True)
        code = ('import gi,sys,time\nfrom gi.repository import Gio\n'
                'app=Gio.DesktopAppInfo.new_from_filename(sys.argv[1])\n'
                'assert app is not None\nassert app.launch([],None)\n')
        env = os.environ.copy();env['CX_ARGV'] = str(output)
        subprocess.run(['/usr/bin/python', '-c', code, str(entry)], env=env, check=True)
        import time
        for _ in range(100):
            if output.exists(): break
            time.sleep(.01)
        self.assertEqual(output.read_text().splitlines(), [result['launcher'], str(ort)])
        self.assertFalse((self.root / 'PWNED').exists())


    def test_wrapper_preserves_profile_arguments_backup_checksum_and_lifetime_lock(self):
        root = self.root / 'profile " $x `name` ; %f'
        root.mkdir()
        script = root / 'launch-demo'
        script.write_text('''#!/usr/bin/env bash
set -euo pipefail
DEMO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export XDG_DATA_HOME="$DEMO_DIR/desktop-data"
export XDG_CONFIG_HOME="$DEMO_DIR/desktop-config"
export XDG_CACHE_HOME="$DEMO_DIR/desktop-cache"
export COXINHA_VAULT="$DEMO_DIR/desktop-vault"
export ORT_DYLIB_PATH="$DEMO_DIR/public-ort.so"
exec python3 "$DEMO_DIR/stage.py" "$@"
''')
        script.chmod(0o755)
        (root / 'stage.py').write_text('''import fcntl, hashlib, json, os, shutil, sys
from pathlib import Path
root=Path(__file__).resolve().parent
lock=open(root / '.session-launch.lock','a+')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
binary=root / 'native'
if hashlib.sha256(binary.read_bytes()).hexdigest() != (root / 'checksum').read_text():
    raise RuntimeError('checksum mismatch')
marker=root / 'complete.json'
if not marker.exists():
    for sub in ['desktop-data','desktop-vault','desktop-config']:
        shutil.copytree(root/sub,root/'backup'/sub)
    marker.write_text(json.dumps({'automatic_restore':False}))
os.set_inheritable(lock.fileno(),True)
os.execv(str(binary),['Coxinha',*sys.argv[1:]])
''')
        for sub in ['desktop-data', 'desktop-config', 'desktop-cache', 'desktop-vault']:
            (root / sub).mkdir()
            (root / sub / 'synthetic.txt').write_text(sub)
        cfile = self.root / 'native.c'
        cfile.write_text('''#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(int argc,char**argv){FILE*f=fopen(getenv("CX_RECORD"),"w");
for(int i=0;i<argc;i++){fputs(argv[i],f);fputc(0,f);}
char*keys[]={"XDG_DATA_HOME","XDG_CONFIG_HOME","XDG_CACHE_HOME","COXINHA_VAULT","ORT_DYLIB_PATH"};
for(int i=0;i<5;i++){fputs(getenv(keys[i]),f);fputc(0,f);}fclose(f);
for(int i=0;i<1000 && access(getenv("CX_RELEASE"),F_OK)!=0;i++)usleep(10000);
return 0;}
''')
        subprocess.run(['cc', str(cfile), '-o', str(root / 'native')], check=True)
        digest = hashlib.sha256((root / 'native').read_bytes()).hexdigest()
        (root / 'checksum').write_text(digest)
        args = ['--hidden', 'two words', '" \x5c $d `touch PWNED` ; & %U']
        result = installer.install(self.destination, script, launcher_mode='wrapper', launcher_args=args)
        self.assertEqual(result['launcher'], str(script))
        self.assertFalse((self.destination / 'coxinha').exists())
        subprocess.run(['desktop-file-validate', result['desktopEntry']], check=True)
        self.assertEqual(installer.install(self.destination, script, launcher_mode='wrapper',
                                          launcher_args=args)['created'], [])
        record, release = self.root / 'record', self.root / 'release'
        env = os.environ.copy()
        env.update(CX_RECORD=str(record), CX_RELEASE=str(release), XDG_DATA_HOME='/wrong',
                   COXINHA_VAULT='/wrong', ORT_DYLIB_PATH='/wrong')
        code = ("import os,sys\nfrom gi.repository import Gio,GLib\nchildren=[]\n"
                "app=Gio.DesktopAppInfo.new_from_filename(sys.argv[1])\n"
                "app.launch_uris_as_manager([],None,GLib.SpawnFlags.DO_NOT_REAP_CHILD,"
                "None,None,lambda info,pid,data:children.append(pid),None)\n"
                "assert len(children)==1\nos.waitpid(children[0],0)\n")
        owner = subprocess.Popen(['/usr/bin/python', '-c', code, result['desktopEntry']], env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(200):
                if record.exists(): break
                time.sleep(.01)
            values = record.read_bytes().split(b'\0')[:-1]
            expected = ['Coxinha', *args, *[str(root / sub) for sub in [
                'desktop-data', 'desktop-config', 'desktop-cache', 'desktop-vault', 'public-ort.so']]]
            self.assertEqual(values, [value.encode() for value in expected])
            with (root / '.session-launch.lock').open('r+') as lock:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            duplicate = subprocess.run([str(script)], env=env, capture_output=True)
            self.assertNotEqual(duplicate.returncode, 0)
            for sub in ['desktop-data', 'desktop-config', 'desktop-vault']:
                self.assertEqual((root / 'backup' / sub / 'synthetic.txt').read_text(), sub)
            self.assertFalse((root / 'backup/desktop-cache').exists())
            self.assertFalse((self.root / 'PWNED').exists())
        finally:
            release.touch()
            owner.wait(timeout=15)
        with (root / '.session-launch.lock').open('r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        record.unlink()
        (root / 'checksum').write_text('invalid')
        rejected = subprocess.run([str(script)], env=env, capture_output=True)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertFalse(record.exists())

    def test_wrapper_mode_is_explicit_and_cannot_override_owned_environment(self):
        script = self.root / 'wrapper'
        script.write_text('#!/usr/bin/python3\nraise RuntimeError("must never run")\n')
        script.chmod(0o755)
        for kwargs in [{'launcher_mode': 'wrapper', 'ort_library': self.launcher},
                       {'launcher_mode': 'unknown'},
                       {'launcher_mode': 'wrapper', 'launcher_args': ['bad\nargument']}]:
            with self.assertRaises(ValueError):
                installer.install(self.destination, script, **kwargs)
        with self.assertRaises(ValueError):
            installer.install(self.destination, self.launcher, launcher_mode='wrapper')
        self.assertFalse(self.destination.exists())


if __name__ == '__main__': unittest.main()
