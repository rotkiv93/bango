// Import mapping: the inverse of basic.spec.js. Builds the basic instance from `features` and `data.basicData`.
// What the mapping would have filled in anyway (the languages, the package, the SRID) is left out of the text.
/** @type {Import} */
const importer = function (json, { n }) {
  const b = json.data.basicData;
  const same = (a, c) => JSON.stringify(a) === JSON.stringify(c);
  const defaultArtifact = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const customPackage = b.packageInfo && (b.packageInfo.artifact !== defaultArtifact || b.packageInfo.group !== 'es.udc.lbd.gisspl');

  return n('BasicModel', {
    name: b.name,
    version: b.version,
    srid: b.SRID !== undefined && Number(b.SRID) !== 4326 ? Number(b.SRID) : undefined,
    languages: same(b.languages, ['en', 'es', 'gl']) ? undefined : b.languages,
    artifactId: customPackage ? b.packageInfo.artifact : undefined,
    groupId: customPackage ? b.packageInfo.group : undefined,
    dbHost: b.database?.host,
    dbPort: b.database?.port,
    dbName: b.database?.database,
    dbUser: b.database?.username,
    dbPassword: b.database?.password,
    extras: Object.entries(b.extra ?? {}).map(([key, value]) => n('ExtraOption', { key, value: String(value) })),
    features: json.features
  });
};

return importer;
