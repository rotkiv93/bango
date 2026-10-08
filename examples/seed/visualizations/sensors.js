// Visualizations of the sensors: the views of a sensors instance that only this metamodel knows how to draw.
// The file is the body of a function that returns them; `kit` is what bango gives to draw with (a canvas, SVG helpers, tree edits).
//
// Sensor diagram: each sensor as a card (what it stores where, its measurements and dimensions), the ranges that label values,
// the groups, and — drawn lighter, because they belong to other metamodels — the data-model entities and the map the sensors point at.
// Drag a node to move it. Drag from the dot at the side of a sensor onto
//   an entity     to add a spatial dimension along it (hold Shift to make it the fact table instead)
//   a range       to give the range to its first measurement that has none
//   a map         to make it the map the sensor opens with
//   a group       to add the sensor to the group
// Select a node to edit it in the panel at the side; Delete removes the selected sensor, range or group.
//
// What modules offer is drawn too, dashed and locked with the module that offers it: sensors, ranges and groups of a read-only instance,
// and the entities that they add to the data model. They can be pointed at, never edited. The "Offered" button hides or shows them.

const SENSOR = '#2563eb';
const RANGE = '#ea580c';
const GROUP = '#475569';
const ENTITY = '#16a34a';
const MAP = '#64748b';
const SPATIAL = '#16a34a';
const OFFERED = '#8b5cf6';
const CATEGORICAL = '#9333ea';
const LINE_HEIGHT = 16;
const CHAR = 6.6;

const widthOf = lines => Math.max(190, ...lines.map(line => line.length * CHAR + 24));

const freshName = (taken, base) => {
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}${i}`;
    if (!taken.has(name)) return name;
  }
};

const bucketText = b => {
  const p = b.props;
  const left = p.default ? 'default' : p.min !== undefined ? `${p.min} – ${p.max}` : String(p.value);
  return `${left} → ${p.label}`;
};

const visualizations = [
  {
    id: 'sensor-diagram',
    label: 'Sensor diagram',
    description: 'Sensors with their measurements and dimensions, the ranges and groups, and the entities and map they use',
    create(ctx, kit) {
      const { h, svg } = kit;
      let model = { sensors: [], ranges: [], groups: [] };
      let ghosts = { entities: [], maps: [] };
      let allEntities = false;
      let showOffered = true;
      let offers = [];
      let inspected;
      let selectWhenDrawn;
      let lastPaths = new Map();
      let messageTimer;

      const message = h('div', { class: 'bango-cmessage' });
      message.style.display = 'none';
      const say = text => {
        message.textContent = text;
        message.style.display = text ? '' : 'none';
        clearTimeout(messageTimer);
        if (text) messageTimer = setTimeout(() => say(''), 6000);
      };
      const edits = kit.editor(ctx.engine, ctx.metamodel, say);

      const own = () => [...model.sensors, ...model.ranges, ...model.groups];
      const byKey = key => own().find(n => n.key === key);
      const locked = n => `${n.name} is offered by ${n.origin}: it is read-only.`;
      const button = (label, title, onclick) => h('button', { title, onclick }, label);

      const canvas = new kit.Canvas({
        onSelect: key => {
          const found = key === null ? undefined : byKey(key);
          // what is offered is not edited: it has no form
          const picked = found && !found.origin ? found : undefined;
          inspected = picked && JSON.stringify(picked.path);
          ctx.inspect(picked ? picked.path : null);
          if (found?.origin) say(locked(found));
        },
        onOpen: key => {
          const picked = byKey(key);
          if (picked?.origin) return;
          if (picked?.node.range) return ctx.reveal(ctx.metamodel, picked.node.range);
          const ghost = [...ghosts.entities, ...ghosts.maps].find(g => g.key === key);
          if (ghost?.range) ctx.reveal(ghost.metamodel, ghost.range);
        },
        onDelete: async key => {
          const picked = byKey(key);
          if (picked?.origin) return say(locked(picked));
          if (picked && (await edits.remove(picked.path))) ctx.inspect(null);
        },
        onMove: positions => ctx.layout.set(positions),
        onConnect: (from, to, { shift }) => void connect(from, to, shift)
      });
      const entitiesButton = button('Entities', 'Show every entity of the data model, not only those the sensors use', () => {
        allEntities = !allEntities;
        entitiesButton.style.opacity = allEntities ? '1' : '0.6';
        void draw();
      });
      entitiesButton.style.opacity = '0.6';
      const offeredButton = button('Offered', 'Show or hide what modules offer (read-only)', () => {
        showOffered = !showOffered;
        void draw();
      });
      offeredButton.style.display = 'none';
      canvas.toolbar.append(
        button('+ Sensor', 'Add a sensor', () => void add('sensors', 'SensorDef', 'NewSensor')),
        button('+ Range', 'Add a range', () => void add('ranges', 'SensorRange', 'NewRange')),
        button('+ Group', 'Add a group of sensors', () => void add('groups', 'SensorGroup', 'NewGroup')),
        h('span', { class: 'bango-spacer' }),
        entitiesButton,
        offeredButton,
        button('Auto layout', 'Place the nodes again', () => { forgetLayout = true; void draw(); }),
        button('Fit', 'Show everything', () => canvas.fit()),
        button('−', 'Zoom out', () => canvas.zoom(1 / 1.25)),
        button('+', 'Zoom in', () => canvas.zoom(1.25))
      );
      let forgetLayout = false;

      async function add(feature, type, base) {
        const name = freshName(new Set(own().map(n => n.name)), base);
        if (await edits.addNamed([], feature, type, name)) selectWhenDrawn = `${type === 'SensorDef' ? 'sensor' : type === 'SensorRange' ? 'range' : 'group'}:${name}`;
      }

      const kind = key => key.slice(0, key.indexOf(':'));
      const nameOf = key => key.slice(key.indexOf(':') + 1);

      async function connect(from, to, shift) {
        const a = byKey(from);
        const target = kind(to);
        const name = nameOf(to);
        if (!a) return;
        if (a.origin) return say(locked(a));
        if (a.kind === 'group') {
          if (target !== 'sensor') return say('A group holds sensors.');
          return void (await edits.addValue(a.path, 'sensors', name));
        }
        if (a.kind !== 'sensor') return;
        if (target === 'group') {
          const group = byKey(to);
          if (group?.origin) return say(locked(group));
          return void (group && (await edits.addValue(group.path, 'sensors', a.name)));
        }
        if (target === 'entity') {
          if (shift) return void (await edits.set(a.path, 'factTable', name));
          const dimension = await edits.addNamed(a.path, 'dimensions', 'SpatialDimension', freshName(new Set(a.dimensions.map(d => d.name)), `${name}Place`));
          if (dimension) await edits.set(dimension, 'entities', name, 0);
          return;
        }
        if (target === 'map') return void (await edits.set(a.path, 'defaultMap', name));
        if (target === 'range') {
          const index = a.measures.findIndex(m => !m.range);
          if (index < 0) return say(`Every measurement of ${a.name} has a range already; change it in the panel.`);
          await edits.set([...a.path, { feature: 'measureData', index }], 'range', name);
          return;
        }
        say('Nothing to connect there.');
      }

      const refText = (node, feature) => kit.asArray(node.refs[feature])[0]?.text;

      function read(ast, origin, out = { sensors: [], ranges: [], groups: [] }) {
        kit.asArray(ast.children.sensors).forEach((node, i) => {
          out.sensors.push({
            origin,
            kind: 'sensor',
            key: `sensor:${node.name}`,
            node,
            name: node.name,
            path: [{ feature: 'sensors', index: i }],
            moving: !!node.props.moving,
            time: node.props.time,
            geom: node.props.geom,
            entity: refText(node, 'entity'),
            factTable: refText(node, 'factTable'),
            map: refText(node, 'defaultMap'),
            layer: refText(node, 'defaultLayer'),
            measures: kit.asArray(node.children.measureData).map(m => ({ name: m.name, type: m.props.dataType, units: m.props.units, icon: m.props.icon, range: refText(m, 'range') })),
            dimensions: kit.asArray(node.children.dimensions).map(d => ({
              name: d.name,
              spatial: d.type === 'SpatialDimension',
              entities: kit.asArray(d.refs.entities).map(r => r.text),
              field: refText(d, 'field'),
              range: refText(d, 'range')
            }))
          });
        });
        kit.asArray(ast.children.ranges).forEach((node, i) => {
          out.ranges.push({ origin, kind: 'range', key: `range:${node.name}`, node, name: node.name, path: [{ feature: 'ranges', index: i }], buckets: kit.asArray(node.children.buckets) });
        });
        kit.asArray(ast.children.groups).forEach((node, i) => {
          out.groups.push({ origin, kind: 'group', key: `group:${node.name}`, node, name: node.name, path: [{ feature: 'groups', index: i }], sensors: kit.asArray(node.refs.sensors).map(r => r.text) });
        });
        return out;
      }

      /** the entities and maps of the other metamodels that sensors point at, drawn as ghosts */
      async function readGhosts() {
        const out = { entities: [], maps: [] };
        const wanted = new Set();
        const wantedMaps = new Set();
        for (const s of model.sensors) {
          [s.entity, s.factTable].forEach(n => n && wanted.add(n));
          s.dimensions.forEach(d => d.entities.forEach(n => wanted.add(n)));
          if (s.map) wantedMaps.add(s.map);
        }
        const find = async metamodel => {
          try {
            const state = await ctx.engine.getInstance(metamodel);
            return state.available ? state.ast : undefined;
          } catch {
            return undefined;
          }
        };
        const data = await find('datamodel');
        const gis = await find('gismodel');
        // what the modules offer to those metamodels is there to point at too
        const offered = metamodel => offers.filter(o => o.metamodel === metamodel).flatMap(o => o.ast ? [{ origin: o.origin, ast: o.ast }] : []);
        const entities = [
          ...kit.asArray(data?.children.entities).map(e => ({ e })),
          ...offered('datamodel').flatMap(o => kit.asArray(o.ast.children.entities).map(e => ({ e, origin: o.origin })))
        ];
        for (const { e, origin } of entities) {
          if (!allEntities && !wanted.has(e.name)) continue;
          if (out.entities.some(g => g.name === e.name)) continue;
          const geometry = kit.asArray(e.children.fields).find(f => f.type === 'PropertyField' && f.name === 'geometry');
          const detail = [origin && `offered by ${origin}`, geometry && `geometry: ${geometry.props.class}`].filter(Boolean).join(' · ');
          out.entities.push({ key: `entity:${e.name}`, name: e.name, range: origin ? undefined : e.range, metamodel: 'datamodel', origin, detail: detail || undefined });
          wanted.delete(e.name);
        }
        // referenced but missing from the data model: shown, so that the link is not lost
        for (const name of wanted) out.entities.push({ key: `entity:${name}`, name, metamodel: 'datamodel', detail: 'not in the data model' });
        const maps = [
          ...kit.asArray(gis?.children.maps).map(m => ({ m })),
          ...offered('gismodel').flatMap(o => kit.asArray(o.ast.children.maps).map(m => ({ m, origin: o.origin })))
        ];
        for (const { m, origin } of maps) {
          if (!wantedMaps.has(m.name)) continue;
          out.maps.push({ key: `map:${m.name}`, name: m.name, range: origin ? undefined : m.range, metamodel: 'gismodel', origin, detail: origin ? `offered by ${origin}` : m.props.label });
          wantedMaps.delete(m.name);
        }
        for (const name of wantedMaps) out.maps.push({ key: `map:${name}`, name, metamodel: 'gismodel', detail: 'not in the GIS model' });
        return out;
      }

      const frame = (width, height, color, extra = {}) =>
        svg('rect', { width, height, rx: 5, style: `fill:var(--bango-panel,#252526);stroke:${color};stroke-width:1.5${extra.dashed ? ';stroke-dasharray:5 4' : ''}` });
      const header = (width, height, color) => svg('rect', { width, height, rx: 5, style: `fill:${color};fill-opacity:.22;stroke:${color};stroke-width:1.5` });
      const line = (x, y, text, attrs = {}) => svg('text', { x, y, ...attrs }, text);

      /** what is offered is dashed and purple, whatever it is */
      const colorOf = (n, color) => (n.origin ? OFFERED : color);
      const offeredBy = n => (n.origin ? `🔒 ${n.origin} · ` : '');

      function sensorNode(s) {
        const stores = [`entity ${s.entity ?? '?'}  ·  facts ${s.factTable ?? '?'}`, `map ${s.map ?? '?'}  ·  layer ${s.layer ?? '?'}`];
        const measures = s.measures.map(m => `• ${m.name} ${m.type}${m.units ? ` [${m.units}]` : ''}${m.range ? `  ◆ ${m.range}` : ''}`);
        const dims = s.dimensions.map(d => (d.spatial ? `≋ ${d.name}  ${d.entities.join(' › ')}` : `≡ ${d.name}  by ${d.field ?? '?'}${d.range ? `  ◆ ${d.range}` : ''}`));
        const subtitle = `${offeredBy(s)}${s.moving ? 'moving · ' : ''}every ${s.time}s · ${s.geom}`;
        const width = widthOf([s.name, subtitle, ...stores, ...measures, ...dims]);
        const rows = [];
        let y = 54;
        const section = (title, items, color) => {
          if (!items.length) return;
          rows.push(line(10, y + 12, title, { opacity: 0.6, 'font-size': 10, 'letter-spacing': 1 }));
          y += 18;
          items.forEach(text => { rows.push(line(14, y + 10, text, { 'font-family': 'ui-monospace, monospace', ...(color ? { fill: color } : {}) })); y += LINE_HEIGHT; });
          y += 6;
        };
        section('STORES', stores);
        section('MEASUREMENTS', measures);
        section('DIMENSIONS', dims);
        const height = y + 4;
        const color = colorOf(s, SENSOR);
        const el = svg('g', {}, frame(width, height, color, { dashed: !!s.origin }), header(width, 44, color),
          line(10, 18, s.name, { 'font-weight': 700, 'font-size': 13 }),
          line(10, 35, subtitle, { opacity: 0.75 }), ...rows);
        return { id: s.key, el, width, height, handle: !s.origin };
      }

      function rangeNode(r) {
        const shown = r.buckets.slice(0, 6).map(bucketText);
        const lines = r.buckets.length > 6 ? [...shown, `… ${r.buckets.length - 6} more`] : shown;
        const title = `${offeredBy(r)}◆ ${r.name}`;
        const width = widthOf([title, ...lines]) - 30;
        const height = 34 + Math.max(1, lines.length) * LINE_HEIGHT + 8;
        const color = colorOf(r, RANGE);
        const el = svg('g', {}, frame(width, height, color, { dashed: !!r.origin }), header(width, 28, color),
          line(10, 18, title, { 'font-weight': 700, 'font-size': 13 }),
          ...lines.map((text, i) => line(14, 46 + i * LINE_HEIGHT, text, { 'font-family': 'ui-monospace, monospace' })),
          !lines.length && line(14, 46, 'no labels yet', { opacity: 0.6 }));
        return { id: r.key, el, width, height };
      }

      function groupNode(g) {
        const lines = g.sensors.map(n => `• ${n}`);
        const title = `${offeredBy(g)}⊞ ${g.name}`;
        const width = widthOf([title, ...lines]) - 30;
        const height = 34 + Math.max(1, lines.length) * LINE_HEIGHT + 8;
        const color = colorOf(g, GROUP);
        const el = svg('g', {}, frame(width, height, color, { dashed: !!g.origin }), header(width, 28, color),
          line(10, 18, title, { 'font-weight': 700, 'font-size': 13 }),
          ...lines.map((text, i) => line(14, 46 + i * LINE_HEIGHT, text, { 'font-family': 'ui-monospace, monospace' })));
        return { id: g.key, el, width, height, handle: !g.origin };
      }

      function ghostNode(g, color, stereotype) {
        const lines = [stereotype, g.name, ...(g.detail ? [g.detail] : [])];
        const width = widthOf(lines) - 40;
        const height = g.detail ? 62 : 46;
        const el = svg('g', {}, frame(width, height, g.origin ? OFFERED : color, { dashed: true }),
          line(width / 2, 15, stereotype, { 'text-anchor': 'middle', opacity: 0.6 }),
          line(width / 2, 32, g.name, { 'text-anchor': 'middle', 'font-weight': 600, 'font-size': 12 }),
          g.detail && line(width / 2, 49, g.detail, { 'text-anchor': 'middle', opacity: 0.6 }));
        return { id: g.key, el, width, height, fixed: false };
      }

      function edgesOf() {
        const edges = [];
        const has = new Set([...own().map(n => n.key), ...ghosts.entities.map(g => g.key), ...ghosts.maps.map(g => g.key)]);
        const link = (id, from, to, rest) => { if (has.has(to)) edges.push({ id, from, to, ...rest }); };
        for (const s of model.sensors) {
          if (s.entity) link(`stores:${s.key}`, s.key, `entity:${s.entity}`, { color: SENSOR, end: 'arrow', label: 'entity' });
          if (s.factTable) link(`facts:${s.key}`, s.key, `entity:${s.factTable}`, { color: SENSOR, end: 'arrow', dashed: true, label: 'facts' });
          if (s.map) link(`map:${s.key}`, s.key, `map:${s.map}`, { color: MAP, end: 'arrow', dashed: true });
          for (const d of s.dimensions) {
            if (d.spatial) d.entities.forEach((e, i) => link(`dim:${s.key}:${d.name}:${i}`, s.key, `entity:${e}`, { color: SPATIAL, end: 'arrow', label: d.name }));
            else if (d.range) link(`cat:${s.key}:${d.name}`, s.key, `range:${d.range}`, { color: CATEGORICAL, end: 'arrow', dashed: true, label: d.name });
          }
          const used = new Map();
          for (const m of s.measures) if (m.range) used.set(m.range, [...(used.get(m.range) ?? []), m.name]);
          for (const [range, names] of used) link(`range:${s.key}:${range}`, s.key, `range:${range}`, { color: RANGE, end: 'arrow', dashed: true, label: names.join(', ') });
        }
        for (const g of model.groups) for (const n of g.sensors) link(`member:${g.key}:${n}`, g.key, `sensor:${n}`, { color: GROUP, end: 'arrow' });
        return edges;
      }

      /** where the nodes go when nobody has put them anywhere yet: ghosts to the left, sensors, then ranges and groups */
      function initialLayout(nodes) {
        const size = id => nodes.find(n => n.id === id);
        const column = keys => keys.map(size).filter(Boolean);
        return kit.columnLayout([
          column([...ghosts.entities, ...ghosts.maps].map(g => g.key)),
          column(model.sensors.map(s => s.key)),
          column([...model.ranges, ...model.groups].map(r => r.key))
        ]);
      }

      async function draw(given) {
        const state = given ?? (await ctx.engine.getInstance(ctx.metamodel));
        if (!state.ast) {
          model = { sensors: [], ranges: [], groups: [] };
          ghosts = { entities: [], maps: [] };
          canvas.render([], []);
          say(state.problems[0]?.message ?? 'There are no sensors to draw.');
          return;
        }
        model = read(state.ast);
        offers = (state.offered ?? []).filter(o => o.ast);
        const own_ = offers.filter(o => o.metamodel === ctx.metamodel);
        const count = own_.reduce((n, o) => n + kit.asArray(o.ast.children.sensors).length + kit.asArray(o.ast.children.ranges).length + kit.asArray(o.ast.children.groups).length, 0);
        offeredButton.style.display = offers.length ? '' : 'none';
        offeredButton.textContent = count ? `Offered (${count})` : 'Offered';
        offeredButton.classList.toggle('bango-on', showOffered);
        if (showOffered) for (const o of own_) read(o.ast, o.origin, model);
        ghosts = await readGhosts();
        const nodes = [
          ...ghosts.entities.map(g => ghostNode(g, ENTITY, '«entity»')),
          ...ghosts.maps.map(g => ghostNode(g, MAP, '«map»')),
          ...model.sensors.map(sensorNode),
          ...model.ranges.map(rangeNode),
          ...model.groups.map(groupNode)
        ];

        // a node that was renamed keeps where it was
        const known = forgetLayout ? {} : { ...ctx.layout.get(), ...canvas.positions() };
        const paths = new Map();
        let carried = forgetLayout;
        for (const n of own().filter(n => !n.origin)) {
          const key = JSON.stringify([n.kind, n.path]);
          paths.set(key, n.key);
          const before = lastPaths.get(key);
          if (before && before !== n.key && !byKey(before) && known[before] && !known[n.key]) {
            known[n.key] = known[before];
            delete known[before];
            carried = true;
          }
        }
        lastPaths = paths;
        const initial = initialLayout(nodes);
        const positions = {};
        for (const n of nodes) positions[n.id] = known[n.id] ?? initial[n.id];
        forgetLayout = false;

        canvas.render(nodes, edgesOf(), positions);
        if (carried) ctx.layout.set(canvas.positions());

        if (selectWhenDrawn && own().some(n => n.key === selectWhenDrawn)) {
          canvas.select(selectWhenDrawn);
          selectWhenDrawn = undefined;
        } else if (inspected) {
          const same = own().find(n => !n.origin && JSON.stringify(n.path) === inspected);
          if (same && canvas.selected !== same.key) canvas.select(same.key);
        }
      }

      return {
        mount(el) {
          canvas.mount(el);
          canvas.el.appendChild(message);
        },

        update(state) {
          return draw(state);
        },

        reveal(range) {
          ctx.reveal(ctx.metamodel, range);
        },

        dispose() {
          clearTimeout(messageTimer);
          canvas.dispose();
        }
      };
    }
  }
];

return visualizations;
