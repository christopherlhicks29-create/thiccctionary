/**
 * One-time introspection helper. Asks Buffer's GraphQL API about the
 * input types we need (CreatePostInput → AssetsInput → ImageInput).
 */

const BUFFER_GRAPHQL = 'https://api.buffer.com/';

async function introspect(typeName) {
  const query = `
    query I {
      __type(name: "${typeName}") {
        name
        inputFields {
          name
          type {
            name
            kind
            ofType { name kind ofType { name kind } }
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
    body: JSON.stringify({ query }),
  });
  return res.json();
}

for (const typeName of ['AssetsInput', 'ImageInput', 'PhotoInput', 'MediaInput', 'PostInputMetaData']) {
  console.log(`\n=== ${typeName} ===`);
  const json = await introspect(typeName);
  console.log(JSON.stringify(json, null, 2));
}
