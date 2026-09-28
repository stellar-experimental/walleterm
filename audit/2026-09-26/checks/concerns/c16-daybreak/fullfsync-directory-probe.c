#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s DIRECTORY\n", argv[0]);
    return 2;
  }

  int fd = open(argv[1], O_RDONLY | O_DIRECTORY);
  if (fd < 0) {
    fprintf(stderr, "open: %s\n", strerror(errno));
    return 1;
  }

  errno = 0;
  int fsync_result = fsync(fd);
  int fsync_errno = errno;
  errno = 0;
  int fullfsync_result = fcntl(fd, F_FULLFSYNC, 0);
  int fullfsync_errno = errno;
  close(fd);

  printf("{\"fsync\":%d,\"fsync_errno\":%d,\"F_FULLFSYNC\":%d,\"F_FULLFSYNC_errno\":%d}\n",
      fsync_result, fsync_errno, fullfsync_result, fullfsync_errno);
  return fsync_result == 0 && fullfsync_result == 0 ? 0 : 1;
}
