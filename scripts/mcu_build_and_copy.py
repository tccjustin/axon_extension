#!/usr/bin/env python3
"""mcu_build_and_copy.py

MCU firmware build and ROM copy utility for Axon extension.

Usage:
    python3 mcu_build_and_copy.py [PATH]

This script finds the 'build-axon' directory, navigates to the MCU build
directory, runs 'make', and copies the resulting ROM file to the boot-firmware
directory.
"""

import os
import sys
import argparse
import time
import shutil
import subprocess

# --- Constants ---
BUILD_AXON_FOLDER = 'build-axon'
LINUX_YP_PATH = 'linux_yp4.0_cgw_1.x.x_dev'
BOOT_FIRMWARE_FOLDER_DST = 'boot-firmware_tcn1000'
MCU_BUILD_SUFFIX = os.path.join(
    LINUX_YP_PATH, 'build', 'tcn1000-mcu', 'tmp', 'work',
    'cortexm7-telechips-linux-musleabi', 'm7-1', '1.0.0-r0', 'git'
)
ROM_NAME = 'tcn100x_snor.rom'


def parse_args(argv=None):
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description='Build MCU firmware and copy ROM.')
    parser.add_argument('path', nargs='?', default='.', help='Starting path to search for build-axon folder.')
    parser.add_argument('--dry-run', action='store_true', help='Show the computed target path without cd or make')
    parser.add_argument('--timeout', type=int, default=60, help='Allowed age (seconds) for tcn100x_snor.rom (default: 60)')
    parser.add_argument('--force-copy', action='store_true', help='Bypass the age timeout check and force copy the ROM')
    return parser.parse_args(argv)

def find_build_axon(start_path):
    """
    Find the 'build-axon' directory by searching upwards from start_path,
    then downwards up to 2 levels.
    """
    abs_start_path = os.path.abspath(start_path)

    # 1. Search upwards (from current dir to root)
    p = abs_start_path
    parts = p.split(os.sep)
    for i in range(len(parts), 0, -1):
        candidate = os.sep.join(parts[:i])
        if not candidate:
            candidate = os.path.abspath(os.sep)
        build_axon_path = os.path.join(candidate, BUILD_AXON_FOLDER)
        if os.path.isdir(build_axon_path):
            return build_axon_path

    # 2. Search downwards (up to depth 2)
    if os.path.isdir(os.path.join(abs_start_path, BUILD_AXON_FOLDER)):
        return os.path.join(abs_start_path, BUILD_AXON_FOLDER)
    try:
        for d1_name in os.listdir(abs_start_path):
            p1 = os.path.join(abs_start_path, d1_name)
            if not os.path.isdir(p1):
                continue
            if os.path.isdir(os.path.join(p1, BUILD_AXON_FOLDER)):
                return os.path.join(p1, BUILD_AXON_FOLDER)
            try:
                for d2_name in os.listdir(p1):
                    p2 = os.path.join(p1, d2_name)
                    if not os.path.isdir(p2):
                        continue
                    if os.path.isdir(os.path.join(p2, BUILD_AXON_FOLDER)):
                        return os.path.join(p2, BUILD_AXON_FOLDER)
            except PermissionError:
                continue
    except PermissionError:
        pass

    return None

def run_make():
    """Run the 'make' command."""
    print("Running 'make'...")
    try:
        proc = subprocess.run(['make'], check=False)
        return proc.returncode
    except FileNotFoundError:
        print("Error: 'make' not found on PATH.", file=sys.stderr)
        return 127

def find_boot_dir(target):
    candidates = ['boot-firmware-tcn100x', 'boot-firmware_tcn100x']
    for cand in candidates:
        cand_path = os.path.join(target, cand)
        if os.path.isdir(cand_path):
            return cand_path
    return None

def check_and_copy_rom(build_axon_path, mcu_build_path, timeout, force_copy, dry_run=False):
    """
    Check if ROM exists and is recent, then copy it.
    Returns 0 on success, non-zero on error.
    """
    boot_dir = find_boot_dir(mcu_build_path)
    if not boot_dir:
        print(f"Error: Boot firmware directory not found in {mcu_build_path}", file=sys.stderr)
        return 7

    rom_path = os.path.join(boot_dir, ROM_NAME)
    if not os.path.exists(rom_path):
        print(f"Error: {ROM_NAME} not found in {boot_dir}", file=sys.stderr)
        return 8
        
    if not force_copy:
        # Check if ROM is recent enough
        now = time.time()
        mtime = os.path.getmtime(rom_path)
        age = now - mtime
        if age > timeout:
            print(f"Error: {ROM_NAME} is too old ({age:.1f}s > {timeout}s)", file=sys.stderr)
            return 9
    
    # Prepare destination
    dest_dir = os.path.join(build_axon_path, LINUX_YP_PATH, BOOT_FIRMWARE_FOLDER_DST)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, ROM_NAME)
    
    if dry_run:
        print(f"Would copy {rom_path} to {dest_path}")
        return 0
        
    try:
        shutil.copy2(rom_path, dest_path)
        print(f"Successfully copied {ROM_NAME} to {dest_path}")
        return 0
    except Exception as e:
        print(f"Error copying ROM: {e}", file=sys.stderr)
        return 10

def main(argv=None):
    """Main script execution."""
    args = parse_args(argv)

    build_axon_path = find_build_axon(args.path)
    if not build_axon_path:
        print(f"Error: '{BUILD_AXON_FOLDER}' not found.", file=sys.stderr)
        return 4

    mcu_build_path = os.path.join(build_axon_path, MCU_BUILD_SUFFIX)

    if args.dry_run:
        print(f"build-axon found at: {build_axon_path}")
        print(f"Computed MCU build path: {mcu_build_path}")
        print(f"ROM copy destination dir: {os.path.join(build_axon_path, LINUX_YP_PATH, BOOT_FIRMWARE_FOLDER_DST)}")
        return 0

    if not os.path.isdir(mcu_build_path):
        print(f"Error: Computed MCU build path does not exist: {mcu_build_path}", file=sys.stderr)
        return 5

    try:
        os.chdir(mcu_build_path)
        print(f"Changed directory to: {mcu_build_path}")
    except OSError as e:
        print(f"Error: Failed to change directory to {mcu_build_path}: {e}", file=sys.stderr)
        return 6

    make_rc = run_make()
    if make_rc != 0:
        return make_rc

    return check_and_copy_rom(build_axon_path, mcu_build_path, args.timeout, args.force_copy, dry_run=args.dry_run)

sys.exit(main())
