// Stops a release when the GitHub repository in package.json is still the placeholder,
// or when the version tag does not match package.json (see GUIDE.md).
const pkg = require('../package.json');
const pub = (pkg.build.publish || [])[0] || {};
const fail = (msg) => { console.error(`\n✖ Release stopped: ${msg}\n`); process.exit(1); };

if (!pub.owner || pub.owner === 'YOUR_GITHUB_USER') {
  fail('set your GitHub user/organisation in package.json -> build.publish[0].owner (and "repository" / "homepage").');
}
const tag = process.env.GITHUB_REF_NAME;   // set by GitHub Actions, e.g. "v1.2.0"
if (tag && tag.startsWith('v') && tag.slice(1) !== pkg.version) {
  fail(`tag ${tag} does not match package.json version ${pkg.version}. Use "npm version patch|minor|major" to change the version.`);
}
console.log(`✔ Releasing ${pkg.productName} v${pkg.version} to github.com/${pub.owner}/${pub.repo}`);
