const prettier = require('prettier')
const camelcase = require('camelcase')

const prettierOptions = {
  parser: 'babylon',
  semi: false
}

class TypeWriter {
  constructor() {
    this.keypaths = {}
  }

  calculateType(keypath, data) {
    let type = typeof data
    let paths = {}
    if (type === 'object') {
      if (data === null) {
        type = 'null'
      } else if (Array.isArray(data)) {
        type = 'array'
        paths = { '[]': true }
        data.map(value => this.calculateType(keypath + '[]', value))
      } else {
        paths = Object.keys(data).reduce((obj, key) => {
          obj[key] = true
          return obj
        }, {})
        Object.keys(data).forEach(key =>
          this.calculateType(keypath ? keypath + '.' + key : key, data[key])
        )
      }
    }
    const current = this.keypaths[keypath] || {}
    const currentKeypath = current[type]
    if (currentKeypath) {
      Object.keys(currentKeypath).forEach(key => {
        if (!paths[key]) {
          currentKeypath[key] = false
        }
      })
      Object.keys(paths).forEach(key => {
        if (!currentKeypath[key]) {
          currentKeypath[key] = false
        }
      })
    } else {
      current[type] = paths
    }
    this.keypaths[keypath] = current
  }

  interfaceName(key) {
    const name = camelcase((this.prefix + ' ' + key).replace(/\[\]/g, 'Value'))
    return 'I' + name.substring(0, 1).toUpperCase() + name.substring(1)
  }

  addDocument(doc) {
    this.calculateType('', doc)
  }

  addRootField(keyPath, type, required) {
    this.keypaths[''].object[keyPath] = required
    this.keypaths[keyPath] = { [type]: {} }
  }

  createAST(prefix) {
    this.prefix = prefix
    this.interfaces = []
    const root = this.createASTForKeypath('')
    return {
      interfaces: this.interfaces,
      root
    }
  }

  createASTForKeypath(keypath) {
    const current = this.keypaths[keypath] || {} // can be undefined for an empty array
    // create interfaces
    Object.keys(current).forEach(type => {
      if (type !== 'object') return
      const name = this.interfaceName(keypath)
      this.interfaces.push({
        name,
        fields: Object.keys(current[type]).map(key => {
          return {
            name: key,
            required: current[type][key],
            value: this.createASTForKeypath(keypath ? keypath + '.' + key : key)
          }
        })
      })
    })

    // return current keypath AST
    return Object.keys(current).map(type => {
      if (type === 'object') {
        return {
          type: 'object',
          interfaceName: this.interfaceName(keypath)
        }
      }
      if (type === 'array') {
        return {
          type: 'array',
          values: Object.keys(current[type]).reduce((arr, key) => {
            return arr.concat(this.createASTForKeypath(keypath + '[]'))
          }, [])
        }
      }
      return { type }
    })
  }

  createTypeScript(prefix) {
    const ast = this.createAST(prefix)
    const codeForArray = (arr) =>
      arr.length === 0 ? 'any' : arr.map(codeForValue).join(' | ')
    const codeForValue = (value) => {
      if (value.type === 'array') {
        return `Array<${codeForArray(value.values)}>`
      }
      if (value.type === 'object') {
        return value.interfaceName
      }
      if (value.type === 'function') {
        return '{ (): any }'
      }
      return value.type
    }
    const code = `${ast.interfaces
      .map(interfaceObj => {
        const { name, fields } = interfaceObj
        return `
          interface ${name} {
            ${fields
              .map(
                field =>
                  `"${field.name}"${field.required ? '' : '?'}: ${codeForArray(
                    field.value
                  )}`
              )
              .join(';\n')}
          }
        `
      })
      .join('\n')}
    export type ${prefix} = ${codeForArray(ast.root)}
    `
    return prettier.format(code, prettierOptions)
  }

  createInlinedTypeScript() {
    const ast = this.createAST('')
    const codeForArray = (arr) =>
      arr.length === 0 ? 'any' : arr.map(codeForValue).join(' | ')
    const codeForValue = (value) => {
      if (value.type === 'array') {
        return `Array<${codeForArray(value.values)}>`
      }
      if (value.type === 'object') {
        const interfaceName = value.interfaceName
        const definition = this.interfaces.find(i => i.name === interfaceName)
        const fields = definition.fields
        return `{
          ${fields
            .map(
              field =>
                `"${field.name}"${field.required ? '' : '?'}: ${codeForArray(
                  field.value
                )}`
            )
            .join(';\n')}
          }`
      }
      if (value.type === 'function') {
        return '{ (): any }'
      }
      return value.type
    }
    const PREFIX = 'type Foo ='
    const code = PREFIX + codeForArray(ast.root)
    return prettier.format(code, prettierOptions).replace(PREFIX, '').trim()
  }

  _filterNotNullables(field) {
    let required = field.required
    const value = field.value.filter(val => {
      const notNullable = val.type !== 'null' && val.type !== 'undefined'
      required = required && notNullable
      return notNullable
    })
    return {
      value,
      required
    }
  }

  createPropTypes(initialCode) {
    const ast = this.createAST('')
    const codeForArray = (values) =>
      values.length === 1
        ? codeForValue(values[0], false)
        : `PropTypes.oneOfType([${values
            .map(value => codeForValue(value, false))
            .join(',')}])`
    const codeForValue = (value, isRoot) => {
      if (value.type === 'array') {
        const values = value.values
        if (values.length === 0) {
          return 'PropTypes.array'
        } else if (values.length === 1) {
          return `PropTypes.arrayOf(${codeForValue(values[0], false)})`
        }
        return `PropTypes.arrayOf(${codeForArray(values)})`
      }
      if (['string', 'number', 'symbol'].includes(value.type)) {
        return `PropTypes.${value.type}`
      }
      if (value.type === 'boolean') {
        return 'PropTypes.bool'
      }
      if (value.type === 'function') {
        return 'PropTypes.func'
      }
      if (value.type === 'object') {
        const interfaceName = value.interfaceName
        const definition = this.interfaces.find(i => i.name === interfaceName)
        const fields = definition.fields
        if (fields.length === 0) {
          return isRoot ? '' : 'PropTypes.object'
        }
        const code = `{
          ${fields.map(field => {
            const _field = this._filterNotNullables(field)
            return `"${field.name}": ${codeForArray(
              _field.value
            )}${_field.required ? '.isRequired' : ''}`
          })}
        }`
        return isRoot ? code : `PropTypes.shape(${code})`
      }
      return 'Unknown'
    }
    const code =
      ast.root.length === 1 && ast.root[0].type === 'object'
        ? codeForValue(ast.root[0], true)
        : codeForArray(ast.root)

    return code
      ? prettier.format(`${initialCode} = ${code}`, prettierOptions)
      : ''
  }

  createVueValidation() {
    const ast = this.createAST('')
    if (ast.root.length !== 1 || ast.root[0].type !== 'object') return ''
    const root = ast.root[0]
    const interfaceName = root.interfaceName
    const definition = this.interfaces.find(i => i.name === interfaceName)
    const fields = definition.fields

    const codeForSingleValue = (value, required) => {
      const type = value.type
      const upper = type.substring(0, 1).toUpperCase() + type.substring(1)
      if (!required) {
        return upper
      }
      return `{ type: ${upper}, required: true }`
    }

    const codeForValue = (value, required) => {
      if (value.length === 1) return codeForSingleValue(value[0], required)
      return `[${value
        .map(val => codeForSingleValue(val, required))
        .join(', ')}]`
    }

    const codeForField = (field) => {
      const _field = this._filterNotNullables(field)
      return `${JSON.stringify(field.name)}: ${codeForValue(
        _field.value,
        _field.required
      )}`
    }

    const code = `{ ${fields.map(field => codeForField(field)).join(', ')} }`
    const prefix = 'const foo = '
    return prettier.format(prefix + code, prettierOptions).substring(prefix.length)
  }
}

module.exports = TypeWriter
