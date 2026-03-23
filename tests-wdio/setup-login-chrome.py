#!/usr/bin/env python3
"""
Log in to Prolific using nodriver (undetected Chrome) and save session cookies.

Usage:
  cd tests-wdio && .venv/bin/python setup-login-chrome.py

Uses branded Chrome with bot-detection bypass to pass Cloudflare challenges.
Saves cookies to .chrome-cookies.json for the WDIO Chrome test config to inject.
Reads credentials from ../.prolific-auth (email=... / password=...).
"""

import asyncio
import json
import os
import sys

import nodriver as uc

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
AUTH_FILE = os.path.join(PROJECT_ROOT, ".prolific-auth")
COOKIES_FILE = os.path.join(SCRIPT_DIR, ".chrome-cookies.json")
PROLIFIC_URL = "https://app.prolific.com/studies"


def read_credentials():
    if not os.path.exists(AUTH_FILE):
        return None, None
    creds = {}
    with open(AUTH_FILE) as f:
        for line in f:
            line = line.strip()
            if "=" in line:
                key, val = line.split("=", 1)
                creds[key.strip()] = val.strip()
    return creds.get("email"), creds.get("password")


async def main():
    headless = "--headless" in sys.argv

    print(f"Cookies file: {COOKIES_FILE}")
    print()

    browser = await uc.start(headless=headless)
    tab = await browser.get(PROLIFIC_URL)

    # Wait for page to stabilize
    await asyncio.sleep(5)

    # Check if we need to log in
    if "auth.prolific.com" in tab.url:
        email, password = read_credentials()
        if email and password:
            print(f"Logging in as {email}...")
            try:
                username_input = await tab.find("#username", timeout=15)
                await username_input.click()
                await asyncio.sleep(0.3)
                await username_input.send_keys(email)

                password_input = await tab.find("#password", timeout=5)
                await password_input.click()
                await asyncio.sleep(0.3)
                await password_input.send_keys(password)

                submit = await tab.find('button[name="action"][value="default"]', timeout=5)
                await submit.click()

                # Wait for redirect to app
                for _ in range(30):
                    await asyncio.sleep(1)
                    if "app.prolific.com" in tab.url:
                        break
                else:
                    print(f"Login may have failed. Current URL: {tab.url}")

            except Exception as e:
                print(f"Automated login failed: {e}")
                if headless:
                    print("Cannot proceed in headless mode.")
                    browser.stop()
                    sys.exit(1)
                print("Please log in manually in the browser window.")
        else:
            if headless:
                print("No credentials and running headless. Cannot log in.")
                browser.stop()
                sys.exit(1)
            print("No credentials found. Please log in manually.")

        if "auth.prolific.com" in tab.url and not headless:
            print("Waiting for manual login...")
            for _ in range(300):
                await asyncio.sleep(1)
                if "app.prolific.com" in tab.url:
                    break

    if "app.prolific.com" not in tab.url:
        print(f"Not on Prolific app. URL: {tab.url}")
        browser.stop()
        sys.exit(1)

    print("Logged in. Saving cookies...")
    await asyncio.sleep(2)

    cookies = await browser.cookies.get_all()
    cookie_list = []
    for c in cookies:
        cookie = {
            "name": c.name,
            "value": c.value,
            "domain": c.domain,
            "path": c.path,
            "secure": c.secure,
            "httpOnly": c.http_only,
        }
        if c.expires and c.expires > 0:
            cookie["expiry"] = int(c.expires)
        cookie_list.append(cookie)

    with open(COOKIES_FILE, "w") as f:
        json.dump(cookie_list, f, indent=2)

    print(f"Saved {len(cookie_list)} cookies to {COOKIES_FILE}")
    print("Chrome tests will use these cookies automatically.")

    browser.stop()
    os._exit(0)


if __name__ == "__main__":
    asyncio.run(main())
