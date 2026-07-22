/* global document */
import { buildSchema } from 'graphql';
import { GraphQLExplorer } from '../../src/modules/graphqlExplorer.js';

const schema = buildSchema(`
  type Query {
    countries: [Country!]!
    country(code: ID!): Country
  }
  type Country {
    code: ID!
    name: String
    capital: String
    continent: Continent
  }
  type Continent {
    code: ID!
    name: String
  }
`);

function makeRail() {
  const rail = document.createElement('div');
  document.body.appendChild(rail);
  return rail;
}

function rootRow(rail, name) {
  return [...rail.querySelectorAll('.graphql-explorer-node')].find(
    row => row.dataset.path === name
  );
}

describe('GraphQLExplorer view', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('renders a search box and a Query section with field rows', () => {
    const rail = makeRail();
    new GraphQLExplorer(rail).render(schema, '', '', null, {});
    expect(rail.querySelector('.graphql-explorer-search')).toBeTruthy();
    expect(rootRow(rail, 'countries')).toBeTruthy();
    expect(rootRow(rail, 'country')).toBeTruthy();
    expect(rootRow(rail, 'country').querySelector('.graphql-explorer-arg-tag')).toBeTruthy();
  });

  test('reflects an existing query as checked boxes', () => {
    const rail = makeRail();
    new GraphQLExplorer(rail).render(schema, '{ countries }', '', null, {});
    expect(rootRow(rail, 'countries').querySelector('input.check').checked).toBe(true);
    expect(rootRow(rail, 'country').querySelector('input.check').checked).toBe(false);
  });

  test('ticking an object field rewrites the query and auto-expands children', () => {
    const rail = makeRail();
    const changes = [];
    const explorer = new GraphQLExplorer(rail);
    explorer.render(schema, '', '', null, { onQueryChange: (t) => changes.push(t) });

    rootRow(rail, 'country').querySelector('input.check').click();

    expect(changes[changes.length - 1]).toContain('country');
    const children = rootRow(rail, 'country').parentElement.querySelector('.graphql-explorer-children');
    expect(children.querySelector('[data-path="country.name"]')).toBeTruthy();
  });

  test('ticking a nested field produces a nested selection', () => {
    const rail = makeRail();
    const changes = [];
    const explorer = new GraphQLExplorer(rail);
    explorer.render(schema, '', '', null, { onQueryChange: (t) => changes.push(t) });

    rootRow(rail, 'country').querySelector('.graphql-explorer-toggle').click();
    rail.querySelector('[data-path="country.name"]').querySelector('input.check').click();

    expect(changes[changes.length - 1]).toMatch(/country[\s\S]*\{[\s\S]*name[\s\S]*\}/);
  });

  test('checking a field with a required argument auto-binds a variable', () => {
    const rail = makeRail();
    const changes = [];
    const explorer = new GraphQLExplorer(rail);
    explorer.render(schema, '', '', null, { onQueryChange: (t) => { changes.push(t); explorer.refreshState(t); } });

    rootRow(rail, 'country').querySelector('input.check').click();

    const last = changes[changes.length - 1];
    expect(last).toContain('country(code: $code)');
    expect(last).toMatch(/\$code: ID!/);
    const argRow = rail.querySelector('.graphql-explorer-arg-row[data-arg="code"]');
    expect(argRow.closest('.graphql-explorer-args').style.display).not.toBe('none');
  });

  test('typing an argument value stores it on the bound variable', () => {
    const rail = makeRail();
    const vars = [];
    const explorer = new GraphQLExplorer(rail);
    explorer.render(schema, '', '', null, {
      onQueryChange: (t) => explorer.refreshState(t),
      onVariablesChange: (v) => vars.push(v)
    });

    rootRow(rail, 'country').querySelector('input.check').click();
    const input = rail.querySelector('.graphql-explorer-arg-row[data-arg="code"] .graphql-explorer-arg-value');
    input.value = 'DE';
    input.dispatchEvent(new Event('input'));
    return new Promise((resolve) => setTimeout(() => {
      expect(JSON.parse(vars[vars.length - 1])).toEqual({ code: 'DE' });
      resolve();
    }, 300));
  });

  test('checking an object field auto-selects its scalar fields but not nested objects', () => {
    const rail = makeRail();
    const changes = [];
    new GraphQLExplorer(rail).render(schema, '', '', null, { onQueryChange: (t) => changes.push(t) });

    rootRow(rail, 'country').querySelector('input.check').click();

    const last = changes[changes.length - 1];
    expect(last).toMatch(/name/);
    expect(last).toMatch(/capital/);
    expect(last).not.toMatch(/continent\s*\{/);
  });

  test('refreshState updates checkboxes without a rebuild', () => {
    const rail = makeRail();
    const explorer = new GraphQLExplorer(rail);
    explorer.render(schema, '', '', null, {});
    explorer.refreshState('{ countries }');
    expect(rootRow(rail, 'countries').querySelector('input.check').checked).toBe(true);
  });

  test('shows a notice and disables toggles on a syntax error', () => {
    const rail = makeRail();
    const explorer = new GraphQLExplorer(rail);
    explorer.render(schema, '{ countries }', '', null, {});
    explorer.refreshState('{ unclosed');
    expect(rail.querySelector('.graphql-explorer-notice').style.display).not.toBe('none');
    expect(rootRow(rail, 'countries').querySelector('input.check').disabled).toBe(true);
  });

  test('search filters top-level rows by field name', () => {
    const rail = makeRail();
    new GraphQLExplorer(rail).render(schema, '', '', null, {});
    const search = rail.querySelector('.graphql-explorer-search');
    search.value = 'countries';
    search.dispatchEvent(new Event('input'));
    expect(rootRow(rail, 'countries').closest('.graphql-explorer-item').style.display).not.toBe('none');
    expect(rootRow(rail, 'country').closest('.graphql-explorer-item').style.display).toBe('none');
  });
});
