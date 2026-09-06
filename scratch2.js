let modifiedHtml = "some code\ndocument.write(html);\nmore code";
modifiedHtml = modifiedHtml.replace(
  'document.write(html);',
  'document.write(html.replace(/<script[^>]*src=["\']https:\\/\\/umami\\.techmitten\\.com\\/recorder\\.js["\'][^>]*><\\/script>\\s*/gi, ""));'
);
console.log(modifiedHtml);
