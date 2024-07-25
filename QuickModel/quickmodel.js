.pragma library
.import QtQuick.LocalStorage 2.0 as Sql

// supported operations
var g_operatorMappings = {
    "equals": {
        "operator": "="
    },
    "not": {
        "operator": "!="
    },
    "in": {
        "operator": "IN",
        "inPrefix": "(",
        "inSuffix": ")"
    },
    "notIn": {
        "operator": "NOT IN",
        "inPrefix": "(",
        "inSuffix": ")"
    },
    "lt": {
        "operator": "<"
    },
    "lte": {
        "operator": "<="
    },
    "gt": {
        "operator": ">"
    },
    "gte": {
        "operator": ">="
    },
    "like": {
        "operator": "LIKE"
    },
    "contains": {
        "operator": "LIKE",
        "inPrefix": "%",
        "inSuffix": "%"
    },
    "startsWith": {
        "operator": "LIKE",
        "inSuffix": "%"
    },
    "endsWith": {
        "operator": "LIKE",
        "inPrefix": "%"
    }
}


/*
  new QMDatabase('myApp', '1.0')
  define : returns an object with functions create/filter/delete
  create: returns an object with the properties
  */
function QMDatabase(appName, version) {
    this.printDebugLogs = false
    this.migrating = false
    //Tables to handle version control
    this.conn = Sql.LocalStorage.openDatabaseSync(appName + '_db', "",
                                                  appName, 100000)

    // to control metadata (__DbVersion__) changes only
    var DbVersion
    var newMetaVersion = "3"

    this.models = {}

    if (this.conn.version !== newMetaVersion) {
        this.conn = this.conn.changeVersion(this.conn.version, newMetaVersion,
                                            (function (tx) {
                                                this.tx = tx
                                                console.log("Metadata version changed from",
                                                            this.conn.version,
                                                            "to",
                                                            newMetaVersion)
                                                this.migrating = true
                                                DbVersion = this._defineDbVersion(
                                                            this)
                                                this.tx = null
                                            }).bind(this))
    } else {
        DbVersion = this._defineDbVersion(this)
    }

    this.dbVersion = DbVersion.filterOne()

    if (this.dbVersion) {
        if (this.dbVersion.version !== version) {
            console.log("Migrating db", this.dbVersion.version, "=>", version)
            this.dbVersion.version = version
            this.dbVersion.migrated = 0
            this.dbVersion.save()
            DbVersion.filter({
                                 "id": {
                                     "not": this.dbVersion.id
                                 }
                             }).remove()
        }
    } else {
        console.log("Creating db ", version)
        this.dbVersion = DbVersion.create({
                                              "version": version,
                                              "migrated": 0
                                          })
    }

    if (this.dbVersion.migrated !== 1) {
        this.migrating = true
    }
}

QMDatabase.prototype = {
    "constructor": QMDatabase,
    "fdCustom": function (type, params) {
        return new QMField(type, params)
    },
    "fdBlob": function (params) {
        return new QMField('BLOB', params)
    },
    "fdString": function (params) {
        return new QMField('TEXT', params)
    },
    "fdInteger": function (params) {
        return new QMField('INTEGER', params)
    },
    "fdFloat": function (params) {
        return new QMField('FLOAT', params)
    },
    "fdReal": function (params) {
        return new QMField('REAL', params)
    },
    "fdNumeric": function (params) {
        return new QMField('NUMERIC', params)
    },
    "fdDate": function (params) {
        return new QMField('DATE', params)
    },
    "fdTime": function (params) {
        return new QMField('TIME', params)
    },
    "fdDateTime": function (params) {
        return new QMField('DATETIME', params)
    },
    "fdBoolean": function (params) {
        return new QMField('BOOLEAN', params)
    },
    "fdCalculated": function (params) {
        return new QMField('CALCULATED', params)
    },
    "fdPK": function (type, params) {
        if (typeof type !== 'string') {
            // @disable-check M126
            if (params == null) {
                params = type
            }
            type = "INTEGER"
        }
        // @disable-check M126
        if (params == null) {
            params = {}
        }
        params['primary'] = true

        return new QMField(type, params)
    },
    "fdFK": function (type, params) {
        if (typeof type !== 'string') {
            // @disable-check M126
            if (params == null) {
                params = type
            }
            type = "INTEGER"
        }

        // @disable-check M126
        if (params['references'] == null) {
            console.error("Wrong FK definition need references field")
        }

        return new QMField(type, params)
    },
    "_defineField": function (column, data) {
        var sql
        var items = []
        var fk = ""

        items.push(column)
        items.push(data.type)

        for (var param in data.params) {
            const value = data.params[param]
            switch (param) {
            case 'primary':
                if (value) {
                    items.push('PRIMARY KEY')
                }
                break
            case 'accept_null':
                if (!value) {
                    items.push('NOT NULL')
                }
                break
            case 'unique':
                if (value) {
                    items.push('UNIQUE')
                }
                break
            case 'references':
                let refField = data.params["references_field"]

                // @disable-check M126
                if (refField == null)
                    refField = "id"

                fk = 'FOREIGN KEY(' + column + ') REFERENCES ' + value + '('
                        + refField + ') ON DELETE CASCADE ON UPDATE CASCADE'
                break
            case 'default':
                items.push('DEFAULT ' + value)
                break
            }
        }

        return {
            "field": items.join(' '),
            "fk": fk
        }
    },
    "retrieveFields": function (db, name) {
        var sql = "PRAGMA table_info(" + name + ")"
        var rs = db.executeSql(sql)

        var fields = {}
        for (var idx = 0; idx < rs.rows.length; idx++) {
            const row = rs.rows[idx]
            var properties = {}
            properties.type = row.type
            if (row.notnull !== 0) {
                if (typeof properties.params === 'undefined')
                    properties.params = {}

                properties.params["accept_null"] = false
            }

            fields[rs.rows[idx].name] = properties
        }

        return fields
    },
    "retrieveTableMeta": function (db, tblName, type) {
        var sql = `SELECT * FROM sqlite_master WHERE type = '${type}' AND tbl_name = '${tblName}';`
        var rs = db.executeSql(sql)

        var ret = []
        for (var i = 0; i < rs.rows.length; ++i) {
            ret.push(rs.rows[i])
        }
        return ret
    },
    "retrieveModel": function (tblName) {
        return this.models[tblName.toLowerCase()]
    },
    "defineModel": function (tblName, definition) {
        const db = this
        let fields = definition.fields
        let triggers = definition.triggers
        let indexes = definition.indexes

        // @disable-check M126
        if (fields == null) {
            fields = definition
        }

        var model = new QMModel(db, tblName, fields)

        if (this.migrating) {
            var sql_create = "CREATE TABLE " + tblName + " ("
            var idx = 0
            var foreign_keys = []

            for (var column in fields) {
                var definitions = fields[column]
                if (definitions.type === "CALCULATED")
                    continue
                var field_data = db._defineField(column, definitions)
                if (idx > 0)
                    sql_create += ", "
                sql_create += field_data['field']

                if (field_data['fk'].length > 0) {
                    foreign_keys.push(field_data['fk'])
                }
                idx++
            }

            // Create foreign key references
            if (foreign_keys.length > 0) {
                sql_create += ", " + foreign_keys.join(", ")
            }

            sql_create += ")"

            this.transaction(function (tx) {
                var oldCreateTable = db.retrieveTableMeta(tx, tblName, 'table')
                if (oldCreateTable.length === 0
                        || oldCreateTable[0].sql !== sql_create) {
                    var oldObjs = []
                    var oldFields = db.retrieveFields(tx, tblName)

                    if (!isEmpty(oldFields)) {
                        var oldModel = new QMModel(tx, tblName, oldFields)
                        oldObjs = oldModel.all()
                        tx.executeSql("DROP TABLE IF EXISTS " + tblName)
                    }

                    //Run create table
                    tx.executeSql(sql_create)

                    for (var i = 0; i < oldObjs.length; i++) {
                        for (var field in oldObjs[i]) {
                            if (field.startsWith('_'))
                                continue

                            const curDef = fields[field]

                            // @disable-check M126
                            if (curDef == null)
                                delete oldObjs[i][field]
                        }
                        oldObjs.tx = tx
                        oldObjs[i].save(true)
                    }
                }

                const currentIndexes = db.retrieveTableMeta(tx,
                                                            tblName, "index")

                for (var di = 0; di < currentIndexes.length; di++) {
                    const index = currentIndexes[di]
                    if (index.name.startsWith("sqlite_"))
                        continue
                    tx.executeSql(`DROP INDEX IF EXISTS ${index.name};`)
                }

                // @disable-check M126
                if (indexes != null) {
                    for (var j = 0; j < indexes.length; j++) {
                        let indexDef = indexes[j]
                        if (typeof indexDef !== "string") {
                            let idxName = indexDef.name
                            const idxFields = indexDef.fields.join(", ")
                            const idxWhere = indexDef.where ?? ""
                            const idxIsUnique = indexDef.unique ? "UNIQUE" : ""

                            // @disable-check M126
                            if (idxName == null) {
                                const idxFieldsJoint = indexDef.fields.join("_")
                                if (indexDef.unique)
                                    idxName = `idx_unique_${tblName}_${idxFieldsJoint}`
                                else
                                    idxName = `idx_${tblName}_${idxFieldsJoint}`
                            }

                            if (idxWhere !== "")
                                idxWhere = `WHERE ${idxWhere}`

                            indexDef = `CREATE ${idxIsUnique} INDEX ${idxName} \n`
                                    + `ON ${tblName} (${idxFields}) ${idxWhere};`
                        }

                        tx.executeSql(indexDef)
                    }
                }

                const currentTriggers = db.retrieveTableMeta(tx, tblName,
                                                             "trigger")

                for (var dt = 0; dt < currentTriggers.length; dt++) {
                    const trigger = currentTriggers[dt]
                    tx.executeSql(`DROP TRIGGER IF EXISTS ${trigger.name};`)
                }

                // @disable-check M126
                if (triggers != null) {
                    for (var ct = 0; ct < triggers.length; ct++) {
                        const triggerDef = triggers[ct]
                        tx.executeSql(triggerDef)
                    }
                }
            })
        }

        this.models[tblName.toLowerCase()] = model
        return model
    },
    "defineView": function (viewName, sql) {
        if (this.migrating) {
            this.transaction(function (db) {
                db.executeSql(`DROP VIEW IF EXISTS ${viewName};`)
                db.executeSql(`CREATE VIEW ${viewName} AS ${sql}`)
            })
        }

        var fields = [] // this.retrieveFields(viewName)

        var view = new QMModel(this, viewName, fields)

        return view
    },
    "executeSql": function (sql) {
        var rs

        if (this.printDebugLogs)
            console.log("Run SQL: " + sql)

        if (!isNull(this.tx)) {
            rs = this.tx.executeSql(sql)
        } else {
            this.conn.transaction(function (tx) {
                rs = tx.executeSql(sql)
            })
        }

        return rs
    },
    "transaction": function (callback) {
        if (!isNull(this.tx)) {
            callback(this)
        } else {
            this.conn.transaction((function (tx) {
                if (this.printDebugLogs)
                    console.log("Run SQL: " + "BEGIN;")

                try {
                    this.tx = tx
                    callback(this)
                    this.tx = null
                } catch (e) {
                    if (this.printDebugLogs)
                        console.log("Run SQL: " + "ROLLBACK;")

                    this.tx = null
                    throw e
                }

                if (this.printDebugLogs)
                    console.log("Run SQL: " + "COMMIT;")
            }).bind(this))
        }
    },
    "_defineDbVersion": function () {
        return this.defineModel('__DbVersion__', {
                                    "id": this.fdPK(),
                                    "version": this.fdString({
                                                                 "accept_null": false
                                                             }),
                                    "migrated": this.fdInteger({
                                                                   "accept_null": false
                                                               })
                                })
    },
    "confirmMigration": function () {
        if (this.migrating) {
            var sql = "SELECT name FROM sqlite_master WHERE type = 'table';"
            var rs = this.executeSql(sql)

            var ret = []
            for (var i = 0; i < rs.rows.length; ++i) {
                const row = rs.rows[i]
                const tableName = row.name
                const model = this.retrieveModel(tableName)
                // @disable-check M126
                if (model != null)
                    continue
                this.executeSql(`DROP TABLE ${tableName};`)
            }

            this.dbVersion.migrated = 1
            this.dbVersion.save()
            this.migrating = false
        }

        delete this.dbVersion
    }
}


/*******************************
  QMModel
  Define a class referencing a database table
  *****************************/
function QMModel(db, tableName, fields, readOnly) {
    this.filterConditions = {}
    this.sorters = []
    this.limiters = null

    if (typeof readOnly === 'undefined')
        readOnly = false

    this._meta = {
        "db": db,
        "tableName": tableName,
        "fields": fields,
        "readOnly": readOnly
    }
}

function isNull(obj) {
    if (obj === undefined)
        return true
    if (obj === null)
        return true

    return false
}

function isEmpty(obj) {
    for (var prop in obj) {
        return false
    }

    return true
}

function isEmpty(obj) {
    // null and undefined are "empty"
    if (obj === null)
        return true

    // Assume if it has a length property with a non-zero value
    // that that property is correct.
    if (obj.length > 0)
        return false
    if (obj.length === 0)
        return true

    // If it isn't an object at this point
    // it is empty, but it can't be anything *but* empty
    // Is it empty?  Depends on your application.
    if (typeof obj !== "object")
        return true

    // Otherwise, does it have any properties of its own?
    // Note that this doesn't handle
    // toString and valueOf enumeration bugs in IE < 9
    for (var key in obj) {
        if (hasOwnProperty.call(obj, key))
            return false
    }

    return true
}

function isObjectEquals(x, y) {
    if (x === y)
        return true

    // if both x and y are null or undefined and exactly the same
    if (isNull(x) && isNull(y))
        return true

    if (!(x instanceof Object) || !(y instanceof Object))
        return false

    // they must have the exact same prototype chain, the closest we can do is
    // test there constructor.
    for (var p in x) {
        // other properties were tested using x.constructor === y.constructor
        if (!y.hasOwnProperty(p) && !isNull(x[p]))
            return false

        if (!isObjectEquals(x[p], y[p]))
            return false
        // Objects and Arrays must be tested recursively
    }

    for (p in y)
        if (!x.hasOwnProperty(p) && !isNull(y[p]))
            return false

    // allows x[ p ] to be set to undefined
    return true
}

QMModel.prototype = {
    "create": function (data, needCalculated = true) {
        var obj = this.makeObject(data, false)
        var insertId = this.insert(obj)

        var objs = this.filter({
                                   "id": insertId
                               }).all(needCalculated)
        if (objs.length > 0) {
            return objs[0]
        }

        return null
    },
    "filter": function (conditions) {
        this.filterConditions = conditions
        return this
    },
    "filterOne": function (conditions) {
        this.filterConditions = conditions
        return this.get()
    },
    "order": function (sorters) {
        if (typeof sorters === 'string') {
            if (!this.sorters) {
                this.sorters = []
            }
            this.sorters.push(sorters)
        } else if (Array.isArray(sorters)) {
            this.sorters = sorters
        }
        return this
    },
    "limit": function (limiter) {
        this.limiter = limiter
        return this
    },
    "get": function () {
        var objs = this.limit(1).all()
        if (objs.length > 0)
            return objs[0]

        return null
    },
    "count": function () {
        var c = -1
        var sql = "SELECT COUNT(*) as count FROM " + this._meta.tableName
        sql += this._defineWhereClause()

        var rs = this._meta.db.executeSql(sql)

        //console.log("RESULT SET: " + rs);
        for (var i = 0; i < rs.rows.length; i++) {
            var item = rs.rows.item(i)
            c = item.count
        }

        this.filterConditions = {}
        this.limiter = null
        this.sorters = null

        return c
    },
    "all": function (needCalculated = true) {
        var sql = "SELECT * FROM " + this._meta.tableName
        sql += this._defineWhereClause()

        if (this.sorters && this.sorters.constructor === String) {
            this.sorters = [this.sorters]
        }

        if (this.sorters && this.sorters.length > 0) {
            sql += " ORDER BY "
            for (var idxOrder = 0; idxOrder < this.sorters.length; idxOrder++) {
                if (idxOrder > 0)
                    sql += ", "
                var ord = this.sorters[idxOrder]
                if (ord[0] === '-') {
                    sql += ord.substring(1) + " DESC "
                } else {
                    sql += ord
                }
            }
        }

        if (this.limiter) {
            sql += " LIMIT " + this.limiter
        }

        var rs = this._meta.db.executeSql(sql)

        //console.log("RESULT SET: " + rs);
        var objs = []
        for (var i = 0; i < rs.rows.length; i++) {
            var item = rs.rows.item(i)
            var obj = this.makeObject(item, needCalculated)
            objs.push(obj)
        }

        this.filterConditions = {}
        this.limiter = null
        this.sorters = null

        return objs
    },
    "update": function (obj) {
        var sql = "UPDATE " + this._meta.tableName + " SET "
        var idx = 0
        for (var field in obj) {
            if (field === 'id')
                continue
            if (field.startsWith('_'))
                continue

            var value = obj[field]

            if (typeof value === "function")
                continue

            const meta = this._fieldMeta(field)
            // @disable-check M126
            if (meta == null || meta.type === "CALCULATED") {
                throw `Unknow field ${field}`
            }

            value = this._convertToSqlType(obj[field], meta)

            if (idx > 0)
                sql += ", "
            sql += `${field} = ${value}`
            idx++
        }
        sql += this._defineWhereClause(this.filterConditions)

        var rs = this._meta.db.executeSql(sql)
        this.filterConditions = {}

        return rs.rowsAffected
    },
    "_insert": function (command, obj) {
        var sql = command + " INTO " + this._meta.tableName + "("
        var fields = []
        var values = []
        for (var field in obj) {
            if (field.startsWith('_'))
                continue

            var value = obj[field]

            if (typeof value === "function")
                continue

            const meta = this._fieldMeta(field)
            // @disable-check M126
            if (meta == null || meta.type === "CALCULATED") {
                throw `Unknow field ${field}`
            }

            if (field === 'id' && isNull(value))
                continue

            if (value === undefined) {
                continue
            }
            fields.push(field)
            if (value === null) {
                values.push('NULL')
            } else {
                value = this._convertToSqlType(value, meta)
                values.push(value)
            }
        }
        sql += fields.join(', ')
        sql += ") VALUES (" + values.join(', ') + ")"

        var rs = this._meta.db.executeSql(sql)
        return rs.insertId
    },
    "insert": function (obj) {
        return this._insert("INSERT", obj)
    },
    "upsert": function (obj) {
        return this._insert("INSERT OR REPLACE", obj)
    },
    "remove": function (value) {
        if (value !== undefined) {
            if (this._typeof(value) === "object") {
                this.filterConditions = value
            } else {
                this.filterConditions = {
                    "id": value
                }
            }
        }

        var sql = "DELETE FROM " + this._meta.tableName
        sql += this._defineWhereClause()
        var rs = this._meta.db.executeSql(sql)
        this.filterConditions = {}

        return rs.rowsAffected
    },
    "_fieldMeta": function (field) {
        const meta = this._meta.fields[field]

        // @disable-check M126
        if (meta != null)
            return meta

        field = field.toLowerCase()
        for (var f in this._meta.fields) {
            if (f.toLowerCase() === field)
                return this._meta.fields[f]
        }

        return undefined
    },
    "_fieldIsValid": function (field) {
        if (this._meta.fields.length === 0)
            return true

        const meta = this._fieldMeta(field)
        // @disable-check M126
        if (meta == null)
            return false

        if (meta.type === "CALCULATED")
            return false

        return true
    },
    "_typeof": function (value) {
        var l_type = typeof value

        // adjusting type based on object instanceof
        // @disable-check M126
        if (value == null) {
            l_type = "null"
        } else if (value.constructor === Array) {
            l_type = "array"
        } else if (l_type === 'object') {
            if (value instanceof Date) {
                l_type = 'date'
            } else if (value instanceof Number) {
                l_type = 'number'
            } else if (value instanceof String) {
                l_type = 'string'
            } else if (value instanceof Boolean) {
                l_type = 'boolean'
            }
        }

        return l_type
    },
    "_convertToSqlType": function (value, definition) {
        var l_type = this._typeof(value)
        var l_desiredType = definition?.type

        if (l_type === "array" || l_type === "object") {
            value = JSON.stringify(value)
            l_type = 'string'
        }

        if (l_type === 'boolean') {
            value = value ? 1 : 0
            l_type = 'number'
        }
        if (l_type === 'date') {
            if (isNaN(value)) {
                return 'null'
            }

            if (l_desiredType === "DATE") {
                const year = value.getUTCFullYear()
                const month = value.getUTCMonth() + 1
                const day = value.getUTCDate()

                value = `${year}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`
            } else {
                value = value.toISOString()
            }
            l_type = 'string'
        }
        if (l_type === 'string') {
            value = "'" + value.replace("'", "''") + "'"
        }

        if (l_type === 'null') {
            value = "null"
        }

        return value
    },
    "_convertFromSqlValue": function (value, definition) {
        if (!definition)
            return value

        // @disable-check M126
        if (value == null)
            return value

        var l_type = this._typeof(value)
        var l_desiredType = definition.type

        if (l_type === 'number') {
            if (l_desiredType === 'BOOLEAN') {
                value = value !== 0
            }
        }

        if (l_type === 'string') {
            if ((l_desiredType === 'FLOAT') || (l_desiredType === 'REAL')
                    || (l_desiredType === 'INTEGER')) {
                value = Number(value)
            } else if ((l_desiredType === 'DATE')
                       || (l_desiredType === 'DATETIME')) {
                var rxDatePattern = /^\d{4}-\d{2}-\d{2}$/
                if (value.match(rxDatePattern)) {
                    value += "T00:00:00Z"
                }
                value = new Date(value)
            } else if (l_desiredType === 'BOOLEAN') {
                switch (value) {
                case "true":
                case "1":
                case "on":
                case "yes":
                    value = true
                    break
                default:
                    var isNum = value.match(/^[0-9]+$/)
                    if (!isNum)
                        value = false
                    else
                        value = value !== 0
                    break
                }
            } else if ((l_desiredType === "ARRAY"
                        || l_desiredType === "JSON")) {
                value = JSON.parse(value)
            }
        }

        return value
    },
    "_arrayToSqlType": function (array) {
        return ret
    },
    "_fieldWhereClause": function (key, value) {
        var l_typeof = this._typeof(value)
        var ret = "("

        if (l_typeof === "array") {
            ret += "IN "
            ret += this._arrayToSqlType(value)
            return ret
        }

        var convertedValue

        if (l_typeof === "object") {
            var idx = 0

            for (var op in value) {
                var v = value[op]
                const opMap = g_operatorMappings[op]
                const inPrefix = opMap.inPrefix ?? ""
                const inSuffix = opMap.inSuffix ?? ""
                const outPrefix = opMap.outPrefix ?? ""
                const outSuffix = opMap.outSuffix ?? ""
                const operator = opMap.operator ?? ""

                if (operator === "") {
                    throw new Error("invalid operator: " + op)
                }

                if (idx > 0) {
                    ret += ") AND ("
                }

                convertedValue = this._convertToSqlType(v, this._fieldMeta(key))

                if (inPrefix !== "") {
                    convertedValue = convertedValue.slice(0, 1) //br
                            + inPrefix + convertedValue.slice(1)
                }

                if (inSuffix !== "") {
                    convertedValue = convertedValue.slice(0, -1) //br
                            + inSuffix + convertedValue.slice(-1)
                }

                ret += key
                ret += " "
                ret += operator
                ret += " "
                ret += outPrefix
                ret += convertedValue
                ret += outSuffix

                ++idx
            }
        } else if (l_typeof === "null") {
            ret += key
            ret += " IS NULL"
        } else {
            convertedValue = this._convertToSqlType(value, this._fieldMeta(key))

            ret += key
            ret += " = "
            ret += convertedValue
        }

        ret += ")"

        return ret
    },
    "_topLevelWhereClause": function (conditions, joint) {
        var idx = 0
        var ret = ""

        if (Array.isArray(conditions)) {
            ret += "("
            for (; idx < conditions.length; ++idx) {
                var item = conditions[idx]
                if (idx > 0) {
                    ret += joint
                }
                ret += this._topLevelWhereClause(item, " AND ")
            }
            ret += ")"
        } else {
            for (var key in conditions) {
                if (idx > 0) {
                    ret += joint
                }
                var value = conditions[key]

                if (key === "AND") {
                    ret += this._topLevelWhereClause(value, " AND ")
                } else if (key === "NOT") {
                    ret += "NOT (" + this._topLevelWhereClause(value,
                                                               " AND ") + ")"
                } else if (key === "OR") {
                    ret += this._topLevelWhereClause(value, " OR ")
                } else {
                    ret += this._fieldWhereClause(key, value)
                }
                ++idx
            }
        }

        return ret
    },
    "_defineWhereClause": function () {
        var sql = ''

        if (isNull(this.filterConditions) || isEmpty(this.filterConditions)) {

            // nothing
        } else if (this.filterConditions.constructor === String) {
            sql = this.filterConditions
        } else {
            sql = this._topLevelWhereClause(this.filterConditions, " AND ")
        }

        if (sql.length > 0) {
            sql = " WHERE " + sql
        }

        return sql
    },
    "makeObject": function (values, needCalculated = true) {
        var obj = new QMObject(this)

        for (var field in values) {
            var value = values[field]
            var idx2Dots = field.indexOf(':')
            if (idx2Dots > 0) {
                field = field.substring(0, idx2Dots)
            }

            if (typeof value === "function")
                continue

            let meta1 = null
            if (this._meta.fields.length !== 0) {
                meta1 = this._fieldMeta(field)
                if (meta1 == null)
                    continue
            }

            value = this._convertFromSqlValue(value, meta1)

            if (!isNull(obj[field]) && isNull(value))
                continue

            obj[field] = value
        }

        if (needCalculated) {
            for (var fm in this._meta.fields) {
                const meta = this._meta.fields[fm]
                if (meta.type !== "CALCULATED")
                    continue

                obj[fm] = function () {
                    return meta.params(obj)
                }
            }
        }

        // TODO: add calculated fields
        return obj
    }
}


/**************************************
  QMObject
  reference a single instance of a object in the database
  *************************************/
function QMObject(model) {
    this._model = model
    this.id = null
}

//Functions for single object
QMObject.prototype = {
    "update": function (filter) {
        var l_rowsAffected = this._model.filter(filter ?? {
                                                    "id": this.id
                                                }).update(this)
        return l_rowsAffected
    },
    "upsert": function (filter) {
        var l_rowsAffected = this._model.upsert(this)
        return l_rowsAffected
    },
    "insert": function (id) {
        if (id)
            this.id = id

        id = this._model.insert(this)

        if (!this.id)
            this.id = id

        return this
    },
    "save": function (forceInsert) {
        if (typeof forceInsert === 'undefined') {
            forceInsert = false
        }

        if (this.id && !forceInsert) {
            var l_rowsAffected = this.update()
            if (l_rowsAffected > 0)
                return this
        }

        return this.insert()
    },
    "remove": function () {
        if (this.id) {
            var l_rowsAffected = this._model.filter({
                                                        "id": this.id
                                                    }).remove()
            if (l_rowsAffected > 0)
                return true
        }

        return false
    },
    "values": function () {
        const ret = {}

        for (var field in this) {
            var value = this[field]

            if (typeof value === "function")
                continue

            if (!this._model._fieldIsValid(field)) {
                continue
            }

            ret[field] = value
        }

        return ret
    },
    "setValues": function (values) {
        const _fields = this._model._meta.fields

        for (var field in values) {
            var value = values[field]

            if (typeof value === "function")
                continue

            if (!this._model._fieldIsValid(field)) {
                continue
            }

            this[field] = value
        }

        return this
    }
}


/*******************************************
  QMField
  Define a database field with attributes
  ******************************************/
function QMField(type, params) {
    this.type = type
    this.params = params
} //TODO: Migrations!//TODO: Replace concatenations with binds '?'
