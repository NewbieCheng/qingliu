//go:build !windows

package main

import "syscall"

// restrictUmask keeps encrypted originals and reports private on disk. Windows
// has no umask; the permission model there is handled by directory ACLs.
func restrictUmask() { syscall.Umask(0o077) }
