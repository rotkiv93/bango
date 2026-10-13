import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@bango/core';
import { errors, openProject } from '../../../test-support/harness.js';

type Json = { [key: string]: JsonValue };
const data = async (bango: Awaited<ReturnType<typeof openProject>>['bango'], metamodel: string) => ((await bango.toJson(metamodel)) as { data: Json }).data;

// what the products of the platform (the real components) read from the specification: see `metamodels/` and `modules/` of LINEA
describe('what the real products need of the specification', () => {
  it('basic: the version, the database port, the deployment settings, and the package the templates read', async () => {
    const { bango } = await openProject('fleet');
    expect(errors((await bango.getInstance('basic')).problems)).toEqual([]);
    const basic = (await data(bango, 'basic')).basicData as Json;
    expect(basic.version).toBe('1.0.0');
    expect(basic.database).toEqual({ host: 'localhost', port: '5432', database: 'postgres', username: 'postgres', password: 'postgres' });
    expect(basic.extra).toEqual({ client_deploy_url: 'http://localhost:1234', geoserver_url: 'http://localhost:9001/geoserver' });
    // `packageInfo.artifact` is what the templates use, and the first page is always the welcome one
    expect(basic.packageInfo).toEqual({ artifact: 'fleet', group: 'es.udc.lbd.gisspl' });
    expect(basic.index).toEqual({ component: 'STATIC', view: 'welcome' });
  });

  it('gismodel: a WMS layer with its server, a map in its own projection and zoom range, and the opacity of a layer on a map', async () => {
    const { bango } = await openProject('fleet');
    expect(errors((await bango.getInstance('gismodel')).problems)).toEqual([]);
    const mapViewer = (await data(bango, 'gismodel')).mapViewer as Json;
    const wms = (mapViewer.layers as Json[]).find(l => l.name === 'ports-wms')!;
    // the templates call it `wms`
    expect(wms).toEqual({ name: 'ports-wms', type: 'wms', label: 'Ports (WMS)', url: 'http://localhost:9001/geoserver/wms', layers: ['ports', 'docks'], defaultStyle: 'portsStyle', availableStyles: ['portsStyle'] });
    const overview = (mapViewer.maps as Json[]).find(m => m.name === 'overview')!;
    expect(overview.mapOptions).toEqual({
      crs: { srid: 'EPSG:25829', proj4Config: { params: '+proj=utm +zone=29 +ellps=GRS80 +units=m +no_defs', options: { origin: [-5120900, 9998100], resolutions: [4891.97, 2445.98] } } },
      minZoom: 4,
      maxZoom: 13
    });
    expect((overview.layers as Json[])[1]).toMatchObject({ name: 'ports-wms', style: 'portsStyle', opacity: 0.5, order: 1 });
    // a map that says nothing of it has no options
    expect((mapViewer.maps as Json[]).find(m => m.name === 'buoys-map')).not.toHaveProperty('mapOptions');
  });

  it('statics: the pages as `{ id, html }`, and back', async () => {
    const { bango } = await openProject('everything');
    expect(errors((await bango.getInstance('statics')).problems)).toEqual([]);
    const statics = (await data(bango, 'statics')).statics as Json[];
    expect(statics.map(p => p.id)).toEqual(['Home', 'About']);
    expect(String(statics[0].html)).toContain('<h1>Welcome</h1>');
    const imported = await bango.importJson(await bango.toProjectJson());
    expect(imported.texts.statics).toContain('page About html "<p>About this product.</p>"');
  });
});
