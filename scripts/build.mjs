import { execFileSync } from 'node:child_process';

// Separate bundles preserve the root entry's standalone CDN contract and keep optional codecs out of it.
for (const [index, name] of ['index', 'binary', 'sequence'].entries()) {
  execFileSync('bunx', ['pkgroll', ...(index === 0 ? ['--clean-dist'] : []), `--packagejson=${name}.*`], { stdio: 'inherit' });
}
