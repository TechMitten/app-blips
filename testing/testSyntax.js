import { checkSyntax } from '../src/lib/syntaxCheck.js';

const html = `
<!DOCTYPE html>
<html>
<body>
<script type="module">
  const App = () => {
    return <div>Hello</div>
  }
</script>
</body>
</html>
`;

console.log(checkSyntax(html));
