import { checkSyntax } from './src/lib/syntaxCheck.js';
const code = `
<!DOCTYPE html>
<html>
<body>
<script type="module">
  const x = 1;
  const y = ;
</script>
</body>
</html>
`;
const errs = checkSyntax(code);
console.log(errs);
