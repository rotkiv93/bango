import type { AstReflection, TypeMetaData } from 'langium';
import { describe, expect, it } from 'vitest';
import { CompositeAstReflection } from '../src/index.js';

const type = (name: string, superTypes: string[] = [], properties: string[] = []): TypeMetaData => ({
  name, superTypes, properties: Object.fromEntries(properties.map(p => [p, { name: p }]))
});
const part = (...types: TypeMetaData[]) => ({ types: Object.fromEntries(types.map(t => [t.name, t])) }) as unknown as AstReflection;

describe('merging the reflections of several metamodels', () => {
  // `datamodel` knows Entity; `security` also knows that an Entity is one kind of Resource; `gismodel` imports Entity but knows nothing of Resource
  const datamodel = part(type('Entity', [], ['name', 'fields']));
  const gismodel = part(type('Entity', [], ['name', 'fields']), type('Layer'));
  const security = part(type('Entity', ['Resource'], ['name', 'fields']), type('FormDef', ['Resource']), type('Resource'));

  it('a relation known to one metamodel holds, whatever order the metamodels come in', () => {
    const orders = [
      [datamodel, gismodel, security], [security, datamodel, gismodel], [gismodel, security, datamodel],
      [datamodel, security, gismodel], [security, gismodel, datamodel], [gismodel, datamodel, security]
    ];
    for (const parts of orders) {
      const merged = new CompositeAstReflection(parts);
      expect(merged.isSubtype('Entity', 'Resource')).toBe(true);
      expect(merged.isSubtype('FormDef', 'Resource')).toBe(true);
      expect(merged.isSubtype('Layer', 'Resource')).toBe(false);
      expect(merged.isSubtype('Entity', 'Entity')).toBe(true);
      expect(merged.getAllSubTypes('Resource').sort()).toEqual(['Entity', 'FormDef', 'Resource']);
    }
  });

  it('properties are merged too, and the parts are not changed', () => {
    const a = part(type('Thing', [], ['name']));
    const b = part(type('Thing', ['Base'], ['size']), type('Base'));
    const merged = new CompositeAstReflection([a, b]);
    expect(Object.keys(merged.types.Thing.properties).sort()).toEqual(['name', 'size']);
    expect(merged.types.Thing.superTypes).toEqual(['Base']);
    expect(Object.keys(a.types.Thing.properties)).toEqual(['name']);
    expect(b.types.Thing.superTypes).toEqual(['Base']);
  });

  it('a super type named by several metamodels appears once', () => {
    const merged = new CompositeAstReflection([part(type('E', ['R'])), part(type('E', ['R', 'S'])), part(type('E', ['S']))]);
    expect(merged.types.E.superTypes).toEqual(['R', 'S']);
  });

  it('subtypes through a chain across metamodels', () => {
    // A is a B in one metamodel, B is a C in another
    const merged = new CompositeAstReflection([part(type('A', ['B']), type('B')), part(type('B', ['C']), type('C'))]);
    expect(merged.isSubtype('A', 'C')).toBe(true);
  });
});
