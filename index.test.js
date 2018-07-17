const TypeWriter = require('./');

test('A test', () => {
  const tw = new TypeWriter()
  tw.addDocument({ firstName: 'Marie', lastName: 'Curie' })
  tw.addDocument({ firstName: 'Ada' })
  expect(tw.createInlinedTypeScript()).toMatchSnapshot()
});

test('Another test', () => {
  const tw = new TypeWriter()
  tw.addDocument({ foo: 'bar' })
  tw.addDocument({ foo: 1 })
  tw.addDocument({ foo: [1, 2, 3] })
  expect(tw.createInlinedTypeScript()).toMatchSnapshot()
});
