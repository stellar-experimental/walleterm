#!/usr/bin/perl
# Phase 7b check 6: interleaved wall-time medians for base and Rust, as MEASUREMENTS.md describes.
# Usage: perl phase-7b-timing.pl <base binary> <rust binary> <input.json> <runs> <command...>
use strict;
use warnings;
use Time::HiRes qw(time);
use POSIX qw(_exit);

my ($base, $rust, $input, $runs, @command) = @ARGV;
my %times = (base => [], rust => []);

sub once {
    my ($binary) = @_;
    my $start = time;
    my $pid = fork() // die "fork: $!";
    if ($pid == 0) {
        chdir '/private/tmp' or _exit(120);
        open(STDIN, '<', $input) or _exit(121);
        open(STDOUT, '>', '/dev/null') or _exit(122);
        open(STDERR, '>', '/dev/null') or _exit(123);
        exec('/usr/bin/env', 'PATH=/usr/bin:/bin', $binary, @command) or _exit(124);
    }
    waitpid($pid, 0);
    my $elapsed = (time - $start) * 1000;
    my $status = $? >> 8;
    return ($elapsed, $status);
}

once($base); once($rust);    # warm-up
for my $i (1 .. $runs) {
    for my $pair ($i % 2 ? (['base', $base], ['rust', $rust]) : (['rust', $rust], ['base', $base])) {
        my ($ms, $status) = once($pair->[1]);
        push @{ $times{ $pair->[0] } }, $ms;
        $times{"status_$pair->[0]"}{$status}++;
    }
}
sub median { my @s = sort { $a <=> $b } @_; my $n = @s; $n % 2 ? $s[$n / 2] : ($s[$n / 2 - 1] + $s[$n / 2]) / 2 }
for my $name ('base', 'rust') {
    my @t = @{ $times{$name} };
    my @sorted = sort { $a <=> $b } @t;
    printf "%s %s: n=%d median=%.2f ms min=%.2f max=%.2f exit=%s\n", "@command", $name, scalar @t, median(@t),
        $sorted[0], $sorted[-1], join(',', map { "${_}x" . $times{"status_$name"}{$_} } sort keys %{ $times{"status_$name"} });
}
