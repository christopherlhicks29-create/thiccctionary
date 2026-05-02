/**
 * One-time introspection helper. Asks Buffer's GraphQL API what fields
 * the CreatePostInput type accepts. Run once to get the schema, then
 * delete this file.
 */

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

const introspection = `
  query IntrospectInput {
    __type(name: "CreatePostInput") {
      name
      inputFields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  }
`;

const res = await fetch(BUFFER_GRAPHQL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`,
  },
  body: JSON.stringify({ query: introspection }),
});

const json = await res.json();
console.log('CreatePostInput fields:');
console.log(JSON.stringify(json, null, 2));
