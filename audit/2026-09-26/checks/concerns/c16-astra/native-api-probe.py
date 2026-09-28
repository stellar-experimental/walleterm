import fcntl
import json
import os
import tempfile

# Values come from the installed macOS SDK's sys/fcntl.h.
# These calls check support on disposable files. They do not test power loss.
checks = []
with tempfile.TemporaryDirectory(prefix='walleterm-c16-astra-native-', dir='/private/tmp') as root:
    file_name = os.path.join(root, 'mock-gate.json')
    file_fd = os.open(file_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    directory_fd = os.open(root, os.O_RDONLY)
    try:
        os.write(file_fd, b'{"mock":true}\n')
        for kind, fd in [('regular file', file_fd), ('directory', directory_fd)]:
            for operation in ['fsync', 'F_FULLFSYNC']:
                try:
                    if operation == 'fsync':
                        os.fsync(fd)
                    else:
                        fcntl.fcntl(fd, 51)
                    checks.append({'target': kind, 'operation': operation, 'result': 'accepted'})
                except OSError as error:
                    checks.append({'target': kind, 'operation': operation, 'result': 'rejected',
                                   'errno': error.errno, 'error': error.strerror})
    finally:
        os.close(directory_fd)
        os.close(file_fd)
print(json.dumps({'checks': checks, 'persistence_claim': 'none; operation support only'}, indent=2))
