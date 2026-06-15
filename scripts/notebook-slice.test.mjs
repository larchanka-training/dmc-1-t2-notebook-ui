import { describe, expect, test } from 'vitest'
import {
  NOTEBOOK_PREFIX,
  STRIP_PREFIX,
  assembleNotebookSpec,
  collectSchemaRefs,
  notebookPaths,
} from './notebook-slice.mjs'

// Minimal backend-shaped fixture: the two notebook paths over a small schema
// graph, plus an unrelated path/schema that must NOT leak into the slice. One
// schema carries a property literally named `description` (the A1 regression).
function fixture() {
  return {
    openapi: '3.1.0',
    info: { title: 'Backend', version: '9.9.9' },
    paths: {
      '/api/v1/notebooks': {
        get: {
          description: 'long operation docstring',
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/NotebookListResponse' },
                },
              },
            },
          },
        },
        post: {
          description: 'long operation docstring',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/NotebookCreate' } },
            },
          },
          responses: {
            201: {
              description: 'Created',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/NotebookResponse' } },
              },
            },
          },
        },
      },
      '/api/v1/notebooks/{notebook_id}': {
        get: {
          responses: {
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/NotebookResponse' } },
              },
            },
          },
        },
      },
      '/api/v1/unrelated': {
        get: {
          responses: {
            200: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Unrelated' } },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: { HTTPBearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        NotebookListResponse: {
          type: 'object',
          description: 'schema docstring',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/NotebookListItem' } },
          },
        },
        NotebookListItem: { type: 'object', properties: { id: { type: 'string' } } },
        NotebookCreate: { type: 'object', properties: { title: { type: 'string' } } },
        NotebookResponse: {
          type: 'object',
          description: 'schema docstring',
          properties: {
            title: { type: 'string' },
            description: { type: 'string', description: 'a real notebook field' },
            cells: { type: 'array', items: { $ref: '#/components/schemas/CellSchema' } },
          },
        },
        CellSchema: { type: 'object', properties: { id: { type: 'string' } } },
        Unrelated: { type: 'object', properties: { x: { type: 'string' } } },
      },
    },
  }
}

describe('notebookPaths', () => {
  test('selects the resource root and sub-paths, excludes siblings, sorted', () => {
    const spec = {
      paths: {
        '/api/v1/notebooks/{notebook_id}': {},
        '/api/v1/notebooks': {},
        '/api/v1/notebooks/{notebook_id}/cells': {},
        '/api/v1/notebooks-archive': {}, // boundary: NOT a notebook path
        '/api/v1/execute': {},
      },
    }
    expect(notebookPaths(spec)).toEqual([
      '/api/v1/notebooks',
      '/api/v1/notebooks/{notebook_id}',
      '/api/v1/notebooks/{notebook_id}/cells',
    ])
  })
})

describe('assembleNotebookSpec', () => {
  test('keeps the notebook paths with the /api/v1 prefix stripped', () => {
    const slice = assembleNotebookSpec(fixture())
    expect(Object.keys(slice.paths).sort()).toEqual(['/notebooks', '/notebooks/{notebook_id}'])
  })

  test('L7: a new notebook sub-path is picked up automatically', () => {
    const spec = fixture()
    spec.paths['/api/v1/notebooks/{notebook_id}/cells'] = {
      get: {
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/NotebookResponse' } },
            },
          },
        },
      },
    }
    expect(Object.keys(assembleNotebookSpec(spec).paths)).toContain(
      '/notebooks/{notebook_id}/cells',
    )
  })

  test('throws when the backend has no notebook paths', () => {
    const spec = fixture()
    delete spec.paths['/api/v1/notebooks']
    delete spec.paths['/api/v1/notebooks/{notebook_id}']
    expect(() => assembleNotebookSpec(spec)).toThrow(/no .* paths/)
  })

  test('inlines the transitive closure, alphabetical, nothing unrelated', () => {
    const names = Object.keys(assembleNotebookSpec(fixture()).components.schemas)
    expect(names).toEqual([
      'CellSchema',
      'NotebookCreate',
      'NotebookListItem',
      'NotebookListResponse',
      'NotebookResponse',
    ])
    expect(names).not.toContain('Unrelated')
    expect(names).toEqual([...names].sort())
  })

  test('drops schema-level description annotations', () => {
    const { schemas } = assembleNotebookSpec(fixture()).components
    expect(schemas.NotebookResponse.description).toBeUndefined()
    expect(schemas.NotebookListResponse.description).toBeUndefined()
  })

  test('A1: a property literally named "description" survives', () => {
    const { schemas } = assembleNotebookSpec(fixture()).components
    expect(schemas.NotebookResponse.properties.description).toBeDefined()
    expect(schemas.NotebookResponse.properties.description.type).toBe('string')
  })

  test('strips operation docstrings but keeps response descriptions', () => {
    const slice = assembleNotebookSpec(fixture())
    expect(slice.paths['/notebooks'].get.description).toBeUndefined()
    expect(slice.paths['/notebooks'].get.responses[200].description).toBe('OK')
  })

  test('carries securitySchemes and synthesizes info from the backend version', () => {
    const slice = assembleNotebookSpec(fixture())
    expect(slice.components.securitySchemes.HTTPBearer).toBeDefined()
    expect(slice.openapi).toBe('3.1.0')
    expect(slice.info.version).toBe('9.9.9')
  })

  test('L9: omits securitySchemes when the backend has none', () => {
    const spec = fixture()
    delete spec.components.securitySchemes
    expect(assembleNotebookSpec(spec).components.securitySchemes).toBeUndefined()
  })

  test('L9: falls back to openapi 3.1.0 / version 0.0.0 when absent', () => {
    const spec = fixture()
    delete spec.openapi
    delete spec.info
    const slice = assembleNotebookSpec(spec)
    expect(slice.openapi).toBe('3.1.0')
    expect(slice.info.version).toBe('0.0.0')
  })

  test('does not mutate the input spec', () => {
    const spec = fixture()
    assembleNotebookSpec(spec)
    expect(spec.paths['/api/v1/notebooks'].get.description).toBe('long operation docstring')
    expect(spec.components.schemas.NotebookResponse.description).toBe('schema docstring')
  })

  test('L5: throws on a non-schema component $ref left in the slice', () => {
    const spec = fixture()
    spec.paths['/api/v1/notebooks'].get.responses[200] = {
      $ref: '#/components/responses/NotFound',
    }
    expect(() => assembleNotebookSpec(spec)).toThrow(/non-schema component/)
  })

  test('L5: throws on an unresolved schema $ref', () => {
    const spec = fixture()
    spec.paths['/api/v1/notebooks'].post.requestBody.content['application/json'].schema = {
      $ref: '#/components/schemas/Missing',
    }
    expect(() => assembleNotebookSpec(spec)).toThrow(/unresolved schema/)
  })

  test('NOTEBOOK_PREFIX is under STRIP_PREFIX', () => {
    expect(NOTEBOOK_PREFIX.startsWith(STRIP_PREFIX)).toBe(true)
  })
})

describe('collectSchemaRefs', () => {
  test('collects nested $refs across arrays and combinators', () => {
    const acc = new Set()
    collectSchemaRefs(
      {
        allOf: [{ $ref: '#/components/schemas/A' }],
        items: { $ref: '#/components/schemas/B' },
        additionalProperties: { $ref: '#/components/schemas/C' },
      },
      acc,
    )
    expect([...acc].sort()).toEqual(['A', 'B', 'C'])
  })

  test('ignores non-schema component refs', () => {
    const acc = new Set()
    collectSchemaRefs({ $ref: '#/components/responses/NotFound' }, acc)
    expect(acc.size).toBe(0)
  })
})
