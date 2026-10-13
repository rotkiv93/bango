import { URI, type LangiumDocument } from 'langium';

// Every document of Bango lives at `memory:/<name>.<extension>`: grammars as `<grammar>.langium`, instances as
// `<metamodel>.<extension>`. An instance that comes from outside the project (see `ContributedInstance`) lives one level down,
// at `memory:/<origin>/<metamodel>.<extension>`. These are the only places that know those shapes.

export const documentUri = (name: string, extension: string) => URI.parse(`memory:/${name}.${extension}`);

/** Who may offer an instance: it becomes a path segment, so nothing that could be read as more than one. */
export const ORIGIN_PATTERN = /^[\w.@+-]+$/;

export const contributedUri = (origin: string, name: string, extension: string) => {
  if (!ORIGIN_PATTERN.test(origin)) throw new Error(`'${origin}' is not a valid origin: use letters, digits and _ . @ + - only`);
  return URI.parse(`memory:/${origin}/${name}.${extension}`);
};

/** `/datamodel.dm` -> `datamodel`; `/user-management/datamodel.dm` -> `datamodel` */
export const nameOfPath = (path: string) => decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)).replace(/\.[^.]+$/, '');

/** `/user-management/datamodel.dm` -> `user-management`; undefined for the documents of the project itself */
export const originOfPath = (path: string): string | undefined => {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? decodeURIComponent(parts[0]) : undefined;
};

export const nameOfDocument = (doc: LangiumDocument) => nameOfPath(doc.uri.path);

export const originOfDocument = (doc: LangiumDocument) => originOfPath(doc.uri.path);

/** `memory:/datamodel.dm` (a URI as a string, e.g. from an LSP result) -> `datamodel` */
export const nameOfUri = (uri: string) => nameOfPath(uri.replace(/^memory:/, ''));

export const originOfUri = (uri: string) => originOfPath(uri.replace(/^memory:/, ''));
