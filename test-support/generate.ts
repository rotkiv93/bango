/**
 * A project of any size, for measuring: `entities` entities with fields and a relation to the previous one, a form and a list for
 * every `forms`-th and `lists`-th entity, roles, users and grants. Every instance is valid (no errors).
 */
export interface GeneratedProject {
  selection: string[];
  instances: Record<string, string>;
}

export function generateProject({ entities = 500, formEvery = 2, listEvery = 5, roles = 20, grantEvery = 3 } = {}): GeneratedProject {
  const entity = (i: number) => [
    `entity E${i} display "$name" {`,
    '  property id: Long autoinc required pk unique',
    '  property name: String required',
    '  property value: Double',
    '  property note: String',
    ...(i > 0 ? [`  relation parent -> E${i - 1}`] : []),
    '}'
  ].join('\n');

  const forms: string[] = [];
  const lists: string[] = [];
  const grants: string[] = [];
  for (let i = 0; i < entities; i++) {
    if (i % formEvery === 0) forms.push(`form F${i} label "Form ${i}" entity E${i} {\n  field name\n  field value\n  field note\n}`);
    if (i % listEvery === 0) lists.push(`list L${i} entity E${i} sortBy name {\n  column name\n  column value label "Value ${i}"\n}`);
    if (i % grantEvery === 0) grants.push(`grant role${i % roles} read on E${i}`);
    if (i % formEvery === 0 && i % grantEvery === 0) grants.push(`grant role${i % roles} write on F${i}`);
    if (i % listEvery === 0 && i % grantEvery === 0) grants.push(`grant role${i % roles} read on L${i}`);
  }
  const roleLines = Array.from({ length: roles }, (_, r) => (r === 0 ? 'role role0' : `role role${r} extends role${r - 1}`));
  const users = Array.from({ length: Math.max(1, roles * 2) }, (_, u) => `user user${u} roles role${u % roles}`);

  return {
    selection: ['datamodel', 'forms', 'lists', 'security'],
    instances: {
      datamodel: `datamodel big\n\n${Array.from({ length: entities }, (_, i) => entity(i)).join('\n\n')}\n`,
      forms: `forms\n\n${forms.join('\n\n')}\n`,
      lists: `lists\n\n${lists.join('\n\n')}\n`,
      security: `security big\n\n${[...roleLines, ...users, ...grants].join('\n')}\n`
    }
  };
}
