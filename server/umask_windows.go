//go:build windows

package main

// restrictUmask is a no-op on Windows: there is no POSIX umask and the data
// directory permissions are managed through NTFS ACLs.
func restrictUmask() {}
