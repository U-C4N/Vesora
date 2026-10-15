/** One release identity; npm SemVer and Python PEP 440 spell prereleases differently. */
export function releaseIdentity(version) {
  const match = typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/.exec(version);
  if (!match) throw new Error(`Unsupported release identity: ${version}`);
  const stable = `${match[1]}.${match[2]}.${match[3]}`;
  return {canonical: version, npm: version, python: match[4] === undefined ? stable : `${stable}rc${match[4]}`, tag: `v${version}`, npmTag: match[4] === undefined ? 'latest' : 'next'};
}
