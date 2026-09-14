import { exec } from "child_process";
import fs from "fs";

export const launchGoogleChrome = (url = "http://localhost:5173") => {
    const candidates = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    ];

    let chromeBin = candidates.find((p) => p && fs.existsSync(p)) || "chrome";

    const cmd = `start "" "${chromeBin}" "${url}"`;
    exec(cmd, (err) => {
        if (err) {
            console.warn("[Chrome Launcher] Could not open Chrome:", err.message);
        } else {
            console.log(`[Chrome Launcher] Opened ${url} in Google Chrome (${chromeBin})`);
        }
    });
};

if (process.argv[1] && process.argv[1].endsWith("launchChrome.js")) {
    launchGoogleChrome(process.argv[2] || "http://localhost:5173");
}
