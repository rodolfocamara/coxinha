#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <time.h>

/* Test-only fault injection: delay mic durability after initial creation. */
int fsync(int fd) {
    static _Atomic unsigned int calls = 0;
    int (*real_fsync)(int) = dlsym(RTLD_NEXT, "fsync");
    char link[64], path[4096];
    snprintf(link, sizeof(link), "/proc/self/fd/%d", fd);
    ssize_t size = readlink(link, path, sizeof(path)-1);
    if (size > 0) {
        path[size] = 0;
        size_t len = strlen(path);
        if (len >= 8 && strcmp(path+len-8, "/mic.wav") == 0 && atomic_fetch_add(&calls, 1) > 0) {
            fprintf(stderr, "INJECTED_FSYNC_DELAY_750MS\n");
            struct timespec delay = {.tv_sec=0, .tv_nsec=750000000};
            while (nanosleep(&delay, &delay) != 0 && errno == EINTR) {}
        }
    }
    return real_fsync(fd);
}
