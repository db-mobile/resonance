import {
  toggleFieldInQuery,
  getSelectedPaths,
  getDeclaredVariables,
  getDeclaredVariableDefs,
  setArgumentValue,
  getArgumentValue
} from '../../src/modules/graphqlExplorer.js';

describe('toggleFieldInQuery', () => {
  test('adds a root field to an empty query', () => {
    const out = toggleFieldInQuery({ queryText: '', path: ['countries'] });
    expect(getSelectedPaths(out).has('countries')).toBe(true);
  });

  test('adds a nested field, creating the parent selection set', () => {
    const out = toggleFieldInQuery({ queryText: '', path: ['country', 'name'] });
    const paths = getSelectedPaths(out);
    expect(paths.has('country')).toBe(true);
    expect(paths.has('country.name')).toBe(true);
  });

  test('removes a field when it is already present', () => {
    const q = `{
  country {
    name
    code
  }
}`;
    const paths = getSelectedPaths(toggleFieldInQuery({ queryText: q, path: ['country', 'name'] }));
    expect(paths.has('country.name')).toBe(false);
    expect(paths.has('country.code')).toBe(true);
    expect(paths.has('country')).toBe(true);
  });

  test('prunes a parent left empty after removing its last child', () => {
    const q = `{
  country {
    name
  }
  continents
}`;
    const paths = getSelectedPaths(toggleFieldInQuery({ queryText: q, path: ['country', 'name'] }));
    expect(paths.has('country')).toBe(false);
    expect(paths.has('country.name')).toBe(false);
    expect(paths.has('continents')).toBe(true);
  });

  test('preserves sibling selections when adding a field', () => {
    const paths = getSelectedPaths(toggleFieldInQuery({ queryText: '{\n  countries\n}', path: ['continents'] }));
    expect(paths.has('countries')).toBe(true);
    expect(paths.has('continents')).toBe(true);
  });

  test('preserves fragments and directives on round-trip', () => {
    const q = `query Q {
  country @include(if: true) {
    ...CountryParts
  }
}

fragment CountryParts on Country {
  name
}`;
    const out = toggleFieldInQuery({ queryText: q, operationName: 'Q', path: ['continents'] });
    expect(out).toContain('fragment CountryParts on Country');
    expect(out).toContain('@include(if: true)');
    expect(getSelectedPaths(out, 'query', 'Q').has('continents')).toBe(true);
  });

  test('targets the operation matching the given name', () => {
    const q = `query First {
  a
}

query Second {
  b
}`;
    const out = toggleFieldInQuery({ queryText: q, operationName: 'Second', path: ['c'] });
    expect(getSelectedPaths(out, 'query', 'Second').has('c')).toBe(true);
    expect(getSelectedPaths(out, 'query', 'First').has('c')).toBe(false);
  });

  test('creates a mutation operation for mutation-type fields', () => {
    const out = toggleFieldInQuery({ queryText: '', operationType: 'mutation', path: ['createUser'], leafIsObject: true });
    expect(getSelectedPaths(out, 'mutation').has('createUser')).toBe(true);
    expect(out).toContain('mutation');
  });
});

describe('toggleFieldInQuery default scalar selection', () => {
  test('pre-selects provided scalar fields when adding an object field', () => {
    const out = toggleFieldInQuery({
      queryText: '',
      path: ['country'],
      leafIsObject: true,
      leafDefaultFields: ['code', 'name']
    });
    const paths = getSelectedPaths(out);
    expect(paths.has('country')).toBe(true);
    expect(paths.has('country.code')).toBe(true);
    expect(paths.has('country.name')).toBe(true);
  });

  test('adds no arguments when a field is checked (args are filled inline)', () => {
    const out = toggleFieldInQuery({ queryText: '', path: ['continent'], leafIsObject: true, leafDefaultFields: ['code'] });
    expect(out).not.toContain('(');
    expect(out).not.toContain('$');
  });

  test('deselecting the last field clears to an empty (recoverable) query', () => {
    const q = 'query GetCountry {\n  country {\n    name\n  }\n}';
    const out = toggleFieldInQuery({ queryText: q, operationName: 'GetCountry', path: ['country'] });
    expect(out.trim()).toBe('');
    expect(getSelectedPaths(out)).not.toBeNull();
    expect(getSelectedPaths(out).size).toBe(0);
  });

  test('adds an empty object selection when no default fields are given', () => {
    const out = toggleFieldInQuery({ queryText: '', path: ['country'], leafIsObject: true });
    expect(getSelectedPaths(out).has('country')).toBe(true);
    expect(getSelectedPaths(out).has('country.code')).toBe(false);
  });
});

describe('getDeclaredVariables', () => {
  test('lists declared variable names', () => {
    expect(getDeclaredVariables('query Q($a: ID!, $b: Int) { x }')).toEqual(['a', 'b']);
  });

  test('returns an empty array for no variables, empty, or invalid input', () => {
    expect(getDeclaredVariables('{ x }')).toEqual([]);
    expect(getDeclaredVariables('')).toEqual([]);
    expect(getDeclaredVariables('{ unclosed')).toEqual([]);
  });
});

describe('getDeclaredVariableDefs', () => {
  test('returns names, printed types, and required flags', () => {
    expect(getDeclaredVariableDefs('query Q($code: ID!, $n: Int, $l: [String!]) { x }')).toEqual([
      { name: 'code', type: 'ID!', required: true },
      { name: 'n', type: 'Int', required: false },
      { name: 'l', type: '[String!]', required: false }
    ]);
  });

  test('returns an empty array for empty or invalid input', () => {
    expect(getDeclaredVariableDefs('')).toEqual([]);
    expect(getDeclaredVariableDefs('{ unclosed')).toEqual([]);
  });
});

describe('getSelectedPaths', () => {
  test('returns an empty set for an empty query', () => {
    expect(getSelectedPaths('').size).toBe(0);
  });

  test('returns null when the query cannot be parsed', () => {
    expect(getSelectedPaths('{ unclosed')).toBeNull();
  });

  test('collects nested paths only for the matching operation type', () => {
    const q = `mutation {
  createUser {
    id
  }
}`;
    expect(getSelectedPaths(q, 'mutation').has('createUser')).toBe(true);
    expect(getSelectedPaths(q, 'mutation').has('createUser.id')).toBe(true);
    expect(getSelectedPaths(q, 'query').size).toBe(0);
  });
});

describe('setArgumentValue', () => {
  const base = '{\n  country {\n    name\n  }\n}';

  test('binds a variable and stores the value', () => {
    const { query, variables } = setArgumentValue({ queryText: base, variablesText: '', path: ['country'], argName: 'code', argType: 'ID!', required: true, raw: 'DE' });
    expect(query).toContain('country(code: $code)');
    expect(query).toMatch(/\$code: ID!/);
    expect(JSON.parse(variables)).toEqual({ code: 'DE' });
  });

  test('coerces number, boolean, and enum-like values', () => {
    expect(JSON.parse(setArgumentValue({ queryText: base, variablesText: '', path: ['country'], argName: 'n', argType: 'Int', raw: '5' }).variables)).toEqual({ n: 5 });
    expect(JSON.parse(setArgumentValue({ queryText: base, variablesText: '', path: ['country'], argName: 'active', argType: 'Boolean', raw: true }).variables)).toEqual({ active: true });
    expect(JSON.parse(setArgumentValue({ queryText: base, variablesText: '', path: ['country'], argName: 'cont', argType: 'Continent', raw: 'EU' }).variables)).toEqual({ cont: 'EU' });
  });

  test('disambiguates a variable name colliding with an existing one', () => {
    const q = 'query Q($code: ID!) {\n  country(code: $code) {\n    name\n  }\n  continent {\n    code\n  }\n}';
    const { query, variables } = setArgumentValue({ queryText: q, variablesText: '{"code":"DE"}', operationName: 'Q', path: ['continent'], argName: 'code', argType: 'ID!', required: true, raw: 'EU' });
    expect(query).toContain('continent(code: $continentCode)');
    expect(query).toContain('$continentCode: ID!');
    expect(JSON.parse(variables)).toEqual({ code: 'DE', continentCode: 'EU' });
  });

  test('clears the value and unbinds an optional argument when emptied', () => {
    const q = 'query Q($code: ID!) {\n  country(code: $code) {\n    name\n  }\n}';
    const { query, variables } = setArgumentValue({ queryText: q, variablesText: '{"code":"DE"}', operationName: 'Q', path: ['country'], argName: 'code', argType: 'ID!', required: false, raw: '' });
    expect(query).not.toContain('$code');
    expect(query).not.toContain('code:');
    expect(variables).toBe('');
  });

  test('keeps a required binding but drops the value when emptied', () => {
    const q = 'query Q($code: ID!) {\n  country(code: $code) {\n    name\n  }\n}';
    const { query, variables } = setArgumentValue({ queryText: q, variablesText: '{"code":"DE"}', operationName: 'Q', path: ['country'], argName: 'code', argType: 'ID!', required: true, raw: '' });
    expect(query).toContain('country(code: $code)');
    expect(query).toContain('$code: ID!');
    expect(variables).toBe('');
  });

  test('sets an argument on a nested field', () => {
    const q = '{\n  country {\n    languages {\n      name\n    }\n  }\n}';
    const { query } = setArgumentValue({ queryText: q, variablesText: '', path: ['country', 'languages'], argName: 'first', argType: 'Int', raw: '3' });
    expect(query).toMatch(/languages\(first: \$/);
  });

  test('leaves query and variables unchanged when the field is absent', () => {
    const res = setArgumentValue({ queryText: base, variablesText: '', path: ['continent'], argName: 'code', argType: 'ID!', raw: 'EU' });
    expect(res.query).toBe(base);
    expect(res.variables).toBe('');
  });
});

describe('getArgumentValue', () => {
  const q = 'query Q($code: ID!, $n: Int, $flag: Boolean, $c: Continent) {\n  country(code: $code, n: $n, flag: $flag, cont: $c) {\n    name\n  }\n}';
  const vars = '{"code":"DE","n":5,"flag":true,"c":"EU"}';

  test('reads the bound variable value for an argument', () => {
    const at = (argName) => getArgumentValue({ queryText: q, variablesText: vars, operationName: 'Q', path: ['country'], argName });
    expect(at('code')).toBe('DE');
    expect(at('n')).toBe('5');
    expect(at('flag')).toBe('true');
    expect(at('cont')).toBe('EU');
  });

  test('returns empty string when the argument or field is absent', () => {
    expect(getArgumentValue({ queryText: '{ country { name } }', variablesText: '', path: ['country'], argName: 'code' })).toBe('');
    expect(getArgumentValue({ queryText: '{ unclosed', variablesText: '', path: ['country'], argName: 'code' })).toBe('');
  });
});
