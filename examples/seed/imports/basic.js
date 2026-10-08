// Import mapping: the inverse of basic.spec.js. Builds the basic instance from `features` and `data.basicData`.
// What the mapping would have filled in anyway (the defaults of the sensor DSL) is left out of the text.
/** @type {Import} */
const importer = function (json, { n }) {
  const b = json.data.basicData;
  const same = (a, c) => JSON.stringify(a) === JSON.stringify(c);
  const index = b.index ?? {};
  const customIndex = index.component !== 'STATIC' || index.view !== 'welcome';
  const customPackage = b.packageInfo && (b.packageInfo.artifactId !== b.name || b.packageInfo.groupId !== `es.udc.lbd.${b.name.toLowerCase()}`);

  return n('BasicModel', {
    name: b.name,
    srid: b.SRID !== undefined && Number(b.SRID) !== 4326 ? Number(b.SRID) : undefined,
    indexComponent: customIndex ? index.component : undefined,
    indexView: customIndex ? index.view : undefined,
    languages: same(b.languages, ['en', 'es', 'gl']) ? undefined : b.languages,
    artifactId: customPackage ? b.packageInfo.artifactId : undefined,
    groupId: customPackage ? b.packageInfo.groupId : undefined,
    dbHost: b.database?.host,
    dbName: b.database?.database,
    dbUser: b.database?.username,
    dbPassword: b.database?.password,
    features: json.features
  });
};

return importer;
