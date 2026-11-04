# Intro to Render Sandboxes — Run untrusted code in an isolated, on-demand environment.


> *Render Sandboxes is in public beta.*
>
> APIs, defaults, and limits might change during the beta period.

*Render Sandboxes* provides managed, ephemeral environments for executing untrusted code. Use sandboxes for AI agents, code interpreters, builds, tests, and other workloads that need an isolated OS environment.

## At a glance

1. You [create a sandbox](sandboxes-creating) with the Render CLI or SDK.
2. Inside the sandbox, you (and your agents) can [execute commands](sandboxes-executing) and [manage files](sandboxes-files).
3. When you're finished with the sandbox, [terminate it](sandboxes-creating#terminating-a-sandbox).
    - Sandboxes also terminate automatically when their configured [runtime timeout](sandboxes-creating#runtime-timeout) expires.
    - You can disable a sandbox's runtime timeout so it [runs indefinitely](sandboxes-creating#running-indefinitely).

Termination permanently deletes the sandbox's filesystem. Before terminating, you can [download any files you need](sandboxes-files#downloading-a-file) or [capture a snapshot](sandboxes-snapshots) to reuse state in a new sandbox.

## Core features

- Isolated execution: [Execute commands](sandboxes-executing) and agent-generated code in a contained environment with its own filesystem.
- Reusable snapshots: [Capture sandbox state](sandboxes-snapshots) to reuse a prepared filesystem or resume a process in a new sandbox.
- File transfers: [Upload any code and files](sandboxes-files), then download the output your sandbox produces.
- Automatic idle suspension: Sandboxes can [suspend when idle](sandboxes-creating#idle-timeout) and resume automatically when you next interact.
- Configurable compute: Choose a [compute plan](sandboxes-creating#compute-plan) with the CPU and RAM each workload needs.
- Network controls: [Configure access](sandboxes-creating#network-access) to allow outbound traffic to a specific set of destinations (or none at all).

## Quickstart

### 1. Install the CLI or SDK

**Tab: CLI**

Requires Render CLI version *2.33.0 or later*.

Use any of the following methods to install the Render CLI or upgrade to the latest version:

**Subtab: Homebrew**

##### Homebrew installation

Run the following commands:

```shell
brew update
brew install render
```

**Subtab: WinGet**

##### WinGet installation

Run the following command:

```shell
winget install render.cli
```

**Subtab: curl**

##### Installing with `curl`

Run the following command:

```shell
curl -fsSL https://raw.githubusercontent.com/render-oss/cli/refs/heads/main/bin/install.sh | sh
```

**Subtab: Direct download**

##### Direct download

1. Open the CLI's [GitHub releases page](https://github.com/render-oss/cli/releases/).
2. Download the executable that corresponds to your system's architecture.

If you use an architecture besides those provided, you can build from source instead.

**Subtab: Build from source**

##### Building from source

> We recommend building from source only if no other installation method works for your system.

1. [Install the Go programming language](https://golang.org/doc/install) if you haven't already.

2. Clone and build the CLI project with the following commands:

   ```shell
   git clone git@github.com:render-oss/cli.git
   cd cli
   go build -o render
   ```

After installation completes, open a new terminal tab and run `render` with no arguments to confirm.

**Tab: TypeScript**

From your TypeScript project directory:

```shell
npm install @renderinc/sdk@latest
```

(Or `pnpm install`, `bun add`, etc.)

*If you already have the SDK installed,* make sure you're using version `1.5.0` or later:

```shell
npm install @renderinc/sdk@latest
```

After installing, make sure `@renderinc/sdk` is listed as a dependency in your `package.json` file at version `^1.5.0` or later.

**Tab: Python**

From your Python project directory:

```shell
pip install render
```

*If you already have the SDK installed,* make sure you're using version `1.5.0` or later:

```shell
pip install --upgrade render
```

After installing, make sure to add `render>=1.5.0` as a dependency in your application's `requirements.txt`, `pyproject.toml`, or equivalent.

### 2. Set up credentials

1. Create an API key from your [Account Settings page](https://dashboard.render.com/u/settings?add-api-key) in the Render Dashboard.

2. Set the following environment variables wherever the CLI or SDK will run, replacing values as indicated:

    ```shell
    export RENDER_API_KEY='rnd_abc123'
    export RENDER_WORKSPACE_ID='tea-def456'
    ```

    - Replace `rnd_abc123` with your API key.
    - Replace `tea-def456` with your workspace's ID, available at the top of its *Settings* page in the [Render Dashboard](https://dashboard.render.com).

3. For the CLI, also set your active workspace:

    ```shell
    render workspace set tea-abc123
    ```

    - Replace `tea-abc123` with your workspace's ID.

### 3. Create a sandbox and execute a command

The following example creates a sandbox with a five-minute runtime timeout, waits until it's running, executes a basic `echo` command, then terminates the sandbox:

**Tab: CLI**

```shell
# Create a sandbox and wait until it's running.
render sandboxes create --timeout=300 --wait

# Replace sbx-abc123 with the ID returned by create.
render sandboxes exec sbx-abc123 -- echo hello from Render

# Terminate the sandbox.
render sandboxes stop sbx-abc123 --confirm
```

**Tab: TypeScript**

```typescript
import { Render } from '@renderinc/sdk'

const sandboxes = new Render().sandboxes
const sandbox = await sandboxes.create({ timeoutSeconds: 300, wait: true })

try {
  const events = await sandboxes.exec(sandbox.id, 'echo hello from Render')

  for await (const event of events) {
    if (event.type === 'output') {
      const stream = event.stream === 'stderr' ? process.stderr : process.stdout
      stream.write(event.data)
    } else if (event.type === 'exit') {
      console.log(`Exit code: ${event.exit_code}`)
    }
  }
} finally {
  await sandboxes.terminate(sandbox.id)
}
```

**Tab: Python (sync)**

```python
import sys
from render import Render
from render.sandbox import SandboxExecExit, SandboxExecOutput

sandboxes = Render().sandboxes
sandbox = sandboxes.create(timeout_seconds=300, wait=True)

try:
    for event in sandboxes.exec(sandbox.id, "echo hello from Render"):
        if isinstance(event, SandboxExecOutput):
            stream = sys.stderr if event.stream == "stderr" else sys.stdout
            print(event.data, end="", file=stream, flush=True)
        elif isinstance(event, SandboxExecExit):
            print(f"Exit code: {event.exit_code}")
finally:
    sandboxes.terminate(sandbox.id)
```

**Tab: Python (async)**

```python
import asyncio
import sys
from render import RenderAsync
from render.sandbox import SandboxExecExit, SandboxExecOutput

async def main():
    sandboxes = RenderAsync().sandboxes
    sandbox = await sandboxes.create(timeout_seconds=300, wait=True)

    try:
        async for event in sandboxes.exec(sandbox.id, "echo hello from Render"):
            if isinstance(event, SandboxExecOutput):
                stream = sys.stderr if event.stream == "stderr" else sys.stdout
                print(event.data, end="", file=stream, flush=True)
            elif isinstance(event, SandboxExecExit):
                print(f"Exit code: {event.exit_code}")
    finally:
        await sandboxes.terminate(sandbox.id)

asyncio.run(main())
```

## Next steps

After creating your first sandbox, explore how to:

- [Execute commands](sandboxes-executing), process their output, and handle command failures.
- [Upload and download files](sandboxes-files), including entire directories.
- [Capture and restore snapshots](sandboxes-snapshots) to reuse files, installed packages, and running processes in new sandboxes.
- [Configure sandbox behavior](sandboxes-creating#configuring-sandbox-behavior), including compute, timeouts, environment variables, and network access.
- [Manage sandbox groups](sandboxes-creating#sandbox-groups) to organize workloads and set separate concurrency limits.

## References

For detailed command and SDK reference material, see:

- [Sandboxes CLI reference](cli-reference#sandboxes)
- [Sandboxes SDK for TypeScript](sandboxes-sdk-typescript)
- [Sandboxes SDK for Python](sandboxes-sdk-python)

## Limits

For available compute plans, sandbox runtime timeouts, concurrency, and API rate limits, see [Limits for Render Sandboxes](sandboxes-limits).

## Beta limitations

We'll address these limitations during the beta period:

- Sandboxes do not yet support private networking to connect to your other Render services and datastores.
- Sandboxes do not yet provide public URLs for accessing applications running inside them.
- Credential brokering is not yet generally available.
- Scoped API keys are not yet generally available.

> *Interested in early access to some of these additions?*
>
> Reach out with details about your use case:


---

##### Appendix: Glossary definitions

###### private network

Your Render services in the same *region* can reach each other without traversing the public internet, enabling faster and safer communication.

Related article: https://render.com/docs/private-network.md