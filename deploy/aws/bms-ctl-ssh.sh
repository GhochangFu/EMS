#!/bin/sh
# ADR 0096 — forced command for the `bmsdeploy` SSH key.
#
# Installed by setup-server.sh as /usr/local/sbin/bms-ctl-ssh and named in
# ~bmsdeploy/.ssh/authorized_keys as command="...",restrict. Whatever the
# client asks to run arrives in SSH_ORIGINAL_COMMAND and is handed to bms-ctl
# as plain words: no shell, no globbing. bms-ctl validates every argument, and
# sudoers allows this user that one program only.
set -f
# shellcheck disable=SC2086 # word splitting is the point; globbing is off
set -- ${SSH_ORIGINAL_COMMAND:-status}
exec sudo -n /usr/local/sbin/bms-ctl "$@"
