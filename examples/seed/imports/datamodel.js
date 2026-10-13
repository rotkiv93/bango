// Import mapping: the inverse of datamodel.spec.js. Builds the data model from `data.dataModel`.
const BASIC = new Set([
  'Boolean', 'Integer', 'Long', 'Float', 'Double', 'String', 'Text', 'Date', 'DateTime', 'LocalDate',
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'Geometry', 'GCAddress', 'IGGallery'
]);

// the patterns of the platform, as the model writes them
const PATTERNS = { ipPattern: 'IP', urlPattern: 'URL', emailPattern: 'Email' };

/** @type {Import} */
const importer = function (json, { n }) {
  const property = p => {
    // numeric keys that generate themselves are written `Long (autoinc)`
    const autoinc = /^(.*) \(autoinc\)$/.exec(p.class);
    const type = autoinc ? autoinc[1] : p.class;
    const custom = p.patternType === 'customPattern';
    return n('PropertyField', {
      name: p.name,
      // a basic type, or else the name of an enumeration
      class: BASIC.has(type) ? type : undefined,
      enumType: BASIC.has(type) ? undefined : type,
      autoinc: !!autoinc,
      required: p.required,
      pk: p.pk,
      unique: p.unique,
      patternType: custom || !p.patternType ? undefined : (PATTERNS[p.patternType] ?? p.patternType),
      pattern: custom ? p.pattern : undefined,
      min: p.min ?? undefined,
      max: p.max ?? undefined
    });
  };

  const relationship = p =>
    n('RelationshipField', { name: p.name, target: p.class, bidirectional: p.bidirectional, owner: p.owner, multiple: p.multiple, required: p.required });

  // only a relationship says who owns it
  const field = p => ('owner' in p ? relationship(p) : property(p));

  const dataModel = json.data.dataModel ?? {};
  const entities = dataModel.entities ?? [];

  return n('Model', {
    entities: entities.map(e =>
      n('Entity', {
        name: e.name,
        displayString: e.displayString,
        superclass: e.superclass,
        abstract: e.abstract,
        traceable: e.traceable,
        fields: e.properties.map(field)
      })
    ),
    enums: (dataModel.enums ?? []).map(e => n('EnumDef', { name: e.name, values: e.values }))
  });
};

return importer;
