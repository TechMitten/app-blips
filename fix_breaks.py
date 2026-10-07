import sys

with open("src/components/DesktopOnboarding.jsx", "r") as f:
    content = f.read()

content = content.replace(
    "title: 'Turn an idea into something you can use.',",
    "title: <>Turn an idea into<br />something you can use.</>,"
)

content = content.replace(
    "title: 'Create, refine and ship — all in one place.',",
    "title: <>Create, refine and ship<br />— all in one place.</>,"
)

content = content.replace(
    "title: 'Choose the AI that builds with you.',",
    "title: <>Choose the AI that<br />builds with you.</>,"
)

with open("src/components/DesktopOnboarding.jsx", "w") as f:
    f.write(content)
