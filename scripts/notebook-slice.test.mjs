import { describe, expect, test } from 'vitest'
import {
  NOTEBOOK_PATHS,
  STRIP_PREFIX,
  assembleNotebookSpec,
  collectSchemaRefs,
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

describe('assembleNotebookSpec', () => {
  test('keeps both notebook paths with the /api/v1 prefix stripped', () => {
    const slice = assembleNotebookSpec(fixture())
    expect(Object.keys(slice.paths).sort()).toEqual(['/notebooks', '/notebooks/{notebook_id}'])
  })

  test('throws when a notebook path is missing', () => {
    const spec = fixture()
    delete spec.paths['/api/v1/notebooks/{notebook_id}']
    expect(() => assembleNotebookSpec(spec)).toThrow(/missing path/)
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

  test('does not mutate the input spec', () => {
    const spec = fixture()
    assembleNotebookSpec(spec)
    expect(spec.paths['/api/v1/notebooks'].get.description).toBe('long operation docstring')
    expect(spec.components.schemas.NotebookResponse.description).toBe('schema docstring')
  })

  test('all notebook paths are /api/v1-prefixed (strip is a no-op-free slice)', () => {
    expect(NOTEBOOK_PATHS.every((p) => p.startsWith(STRIP_PREFIX))).toBe(true)
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
