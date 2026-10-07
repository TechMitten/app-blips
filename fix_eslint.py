import sys

with open("src/components/DesktopOnboarding.jsx", "r") as f:
    content = f.read()

content = content.replace("import { desktopBridge, ipcErrorMessage, providerApi, isDesktop } from '../lib/desktop';", "import { ipcErrorMessage, providerApi, isDesktop } from '../lib/desktop';")

model_notes = """const modelNotes = {
  '~anthropic/claude-sonnet-latest': 'Polished UI and strong all-round coding',
  '~openai/gpt-sol-latest': 'Powerful reasoning for complex builds',
  '~google/gemini-pro-latest': 'Strong planning and large-context work',
  '~openai/gpt-mini-latest': 'A quick, lower-cost everyday choice',
  '~google/gemini-flash-latest': 'Fast iteration and lightweight builds',
};"""

content = content.replace(model_notes, "")

with open("src/components/DesktopOnboarding.jsx", "w") as f:
    f.write(content)
