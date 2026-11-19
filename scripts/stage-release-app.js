import { build } from 'esbuild'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minimumNodeVersion } from '../npm-installer/node-requirement.cjs'

const root = fileURLToPath(new URL('..', import.meta.url))

// Ship only executable code and runtime assets, not npm's development/install tree.
export async function stageReleaseApp(destination) {
  await mkdir(join(destination, 'host'), { recursive: true })
  const result = await build({
    absWorkingDir: root, entryPoints: ['host/server.js'], outfile: join(destination, 'host/server.js'),
    bundle: true, platform: 'node', target: `node${minimumNodeVersion}`, format: 'esm', minify: true,
    metafile: true, legalComments: 'external', tsconfigRaw: {},
    banner: { js: 'import { createRequire as __bundleCreateRequire } from "node:module"; const require = __bundleCreateRequire(import.meta.url);' },
  })
  for (const folder of ['dist', 'dist-setup']) await cp(join(root, folder), join(destination, folder), { recursive: true })
  // Composer resolves these optional local-model installer templates relative to its module.
  await cp(join(root, 'node_modules/@voicemesh/composer/lib/local-runtime'), join(destination, 'host/local-runtime'), { recursive: true })
  await cp(join(root, 'host/desktop-lifecycle.js'), join(destination, 'host/desktop-lifecycle.js'))
  await mkdir(join(destination, 'scripts'), { recursive: true })
  for (const name of ['launch-host.js', 'launch-host.sh', 'install-host-macos.js']) {
    await cp(join(root, 'scripts', name), join(destination, 'scripts', name))
  }
  for (const name of ['node-requirement.cjs', 'node-minimum']) {
    await cp(join(root, 'npm-installer', name), join(destination, 'scripts', name))
  }
  await writeFile(join(destination, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n')

  const packages = new Map()
  for (const input of Object.keys(result.metafile.inputs).filter(path => path.includes('node_modules/'))) {
    let dir = dirname(resolve(root, input))
    while (dir.startsWith(root)) {
      try {
        const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
        if (pkg.name && pkg.version) { packages.set(pkg.name, { ...pkg, dir }); break }
      } catch {}
      dir = dirname(dir)
    }
  }
  const notices = []
  for (const pkg of packages.values()) {
    notices.push(`${pkg.name}@${pkg.version}: ${JSON.stringify(pkg.license ?? 'See license files')}`)
    for (const file of await readdir(pkg.dir)) {
      if (!/^(licen[sc]e|notice|copying|authors)([.-]|$)/i.test(file)) continue
      const out = join(destination, 'licenses', pkg.name)
      await mkdir(out, { recursive: true })
      await cp(join(pkg.dir, file), join(out, file), { recursive: true })
    }
  }
  await writeFile(join(destination, 'THIRD_PARTY_NOTICES'), notices.sort().join('\n') + '\n')
}
