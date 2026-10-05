/** The name of a metamodel becomes the file extension of its instances: lowercase letters and digits, starting with a letter. */
export function validateMetamodelName(name: string, existing: string[] = []): string | undefined {
  if (!name) return 'Give the metamodel a name';
  if (!/^[a-z][a-z0-9]*$/.test(name)) return 'Use lowercase letters and digits, starting with a letter';
  if (existing.includes(name)) return `A metamodel called '${name}' already exists`;
  return undefined;
}

export function validateProjectName(name: string, existing: string[] = []): string | undefined {
  if (!name.trim()) return 'Give the project a name';
  if (existing.includes(name.trim())) return `A project called '${name.trim()}' already exists`;
  return undefined;
}
