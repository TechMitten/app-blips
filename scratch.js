const html = `<!DOCTYPE html>
<html lang="en">
<head><link rel="icon" href="/favicon.ico"><script defer src="https://umami.techmitten.com/script.js" data-website-id="ca809bf2-efae-4cf0-9b0a-e4ba06ea52a3"></script>
<script defer src="https://umami.techmitten.com/recorder.js" data-website-id="ca809bf2-efae-4cf0-9b0a-e4ba06ea52a3"></script><link rel="manifest" id="orion-pwa-manifest">`;
const oldRecorderRegex = /<script[^>]*src=["']https:\/\/umami\.techmitten\.com\/recorder\.js["'][^>]*><\/script>\s*/gi;
console.log(html.replace(oldRecorderRegex, 'REMOVED_RECORDER'));
