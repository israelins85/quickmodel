.pragma library
.import QtQuick.LocalStorage 2.0 as Sql


/*
  new QMDatabase('myApp', '1.0')
  define : returns an object with functions create/filter/delete
  create: returns an object with the properties
  */
function QMDatabase(appName, version) {
    this.migrate = false

    //Tables to handle version control
    this.conn = Sql.LocalStorage.openDatabaseSync(appName + '_db', "",
                                                  appName, 100000)

    // to control metadata (__DbVersion__) changes only
    var DbVersion
    var newMetaVersion = "1.1"

    if (this.conn.version !== newMetaVersion) {
        this.conn = this.conn.changeVersion(this.conn.version, newMetaVersion,
                                            (function (tx) {
                                                this.tx = tx
                                                console.log("Metadata version changed from",
                                                            this.conn.version,
                                                            "to",
                                                            newMetaVersion)
                                                this.migrate = true
                                                DbVersion = this._defineDbVersion(
                                                            this)
                                                this.tx = null
                                            }).bind(this))
    } else {
        DbVersion = this._defineDbVersion(this)
    }

    var dbVersion = DbVersion.filterOne()

    if (dbVersion) {
        var needSave = false

        if (dbVersion.version !== version) {
            console.log("Migrating db", dbVersion.version, "=>", version)
            dbVersion.version = version
            dbVersion.migrated = 0
            dbVersion.save()
        }

        this.migrate = (dbVersion.migrated === 0)
    } else {
        console.log("Creating db ", version)
        dbVersion = DbVersion.create({
                                         "version": version,
                                         "migrated": 0
                                     })
        this.migrate = true
    }
}

QMDatabase.prototype = {
    "constructor": QMDatabase,
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
    "fdDateTime": function (params) {
        return new QMField('DATETIME', params)
    },
    "fdBoolean": function (params) {
        return new QMField('BOOLEAN', params)
    },
    "fdPK": function (params) {
        return new QMField('PK', params)
    },
    "fdFK": function (params) {
        return new QMField('FK', params)
    },
    "_defineField": function (column, data) {
        var sql
        var items = []
        var fk = []

        //If is a foreign key
        if (data.type === 'FK') {
            items.push(column)
            items.push('INTEGER')
            fk.push('FOREIGN KEY(' + column + ')')
        } else if (data.type === 'PK') {
            items.push(column)
            items.push('INTEGER PRIMARY KEY')
        } else {
            items.push(column)
            items.push(data.type)
        }

        for (var param in data.params) {
            switch (param) {
            case 'accept_null':
                if (!data.params[param]) {
                    items.push('NOT NULL')
                }
                break
            case 'unique':
                if (data.params[param]) {
                    items.push('UNIQUE')
                }
                break
            case 'references':
                fk.push('REFERENCES ' + data.params[param]
                        + '(id) ON DELETE CASCADE ON UPDATE CASCADE')
                break
            case 'default':
                items.push('DEFAULT ' + data.params[param])
                break
            }
        }

        return {
            "field": items.join(' '),
            "fk": fk.join(' ')
        }
    },
    "retrieveFields": function (name) {
        var sql = "PRAGMA table_info(" + name + ")"
        var rs = this.executeSql(sql)

        var fields = {}
        for (var idx = 0; idx < rs.rows.length; idx++) {
            var properties = {}
            properties.type = rs.rows[idx].type
            if (rs.rows[idx].pk !== 0)
                properties.type = 'PK'
            if (rs.rows[idx].notnull !== 0) {
                if (typeof properties.params === 'undefined')
                    properties.params = {}

                properties.params["accept_null"] = false
            }

            fields[rs.rows[idx].name] = properties
        }

        return fields
    },
    "retrieveCreateTable": function (name) {
        var sql = "SELECT sql FROM sqlite_master WHERE type = 'table' AND tbl_name = '"
                + name + "';"
        var rs = this.executeSql(sql)

        var createTable = ""
        if (rs.rows.length > 0) {
            createTable = rs.rows[0].sql
        }

        return createTable
    },
    "defineModel": function (name, fields) {
        if (isNull(fields['id']))
            fields['id'] = this.fdPK()
        var model = new QMModel(this, name, fields)

        if (this.migrate) {
            var sql_create = "CREATE TABLE " + name + " ("
            var idx = 0
            var foreign_keys = []
            for (var column in fields) {
                var definitions = fields[column]
                var field_data = this._defineField(column, fields[column])
                if (idx > 0)
                    sql_create += ", "
                sql_create += field_data['field']

                if (field_data['fk'].length > 0) {
                    foreign_keys.push(field_data['fk'])
                }
                idx++
            }

            //Create foreign key references
            for (var ifk = 0; ifk < foreign_keys.length; ifk++) {
                sql_create += ", " + foreign_keys[ifk]
            }

            sql_create += ")"

            var oldCreateTable = this.retrieveCreateTable(name)
            if (oldCreateTable !== sql_create) {
                this.transaction(function (db) {
                    var oldObjs = []
                    var oldFields = db.retrieveFields(name)

                    if (!isEmpty(oldFields)) {
                        var oldModel = new QMModel(db, name, oldFields)
                        oldObjs = oldModel.all()
                        db.executeSql("DROP TABLE IF EXISTS " + name)
                    }

                    //Run create table
                    db.executeSql(sql_create)

                    for (var i = 0; i < oldObjs.length; i++) {
                        for (var field in oldObjs[i]) {
                            if (!(field in fields) && field !== '_model'
                                    && field !== 'save') {
                                delete oldObjs[i][field]
                            }
                        }
                        oldObjs[i].save(true)
                    }
                })
            }
        }

        return model
    },
    "defineView": function (name, sql) {
        if (this.migrate) {
            this.transaction(function (db) {
                db.executeSql("DROP VIEW IF EXISTS " + name)
                db.executeSql("CREATE VIEW " + name + " AS " + sql)
            })
        }

        var fields = this.retrieveFields(name)

        var view = new QMModel(this, name, fields)

        return view
    },
    "executeSql": function (sql) {
        var rs

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
                this.tx = tx

                callback(this)

                this.tx = null
            }).bind(this))
        }
    },
    "_defineDbVersion": function () {
        return this.defineModel('__DbVersion__', {
                                    "version": this.fdString({
                                                                 "accept_null": false
                                                             }),
                                    "migrated": this.fdInteger({
                                                                   "accept_null": false
                                                               })
                                })
    },
    "confirmMigration": function () {
        this.migrate = false
        var DbVersion = this._defineDbVersion()
        var dbVersion = DbVersion.filterOne()

        dbVersion.migrated = 1
        dbVersion.save()
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
    "create": function (data) {
        var obj = this.makeObject(data)
        var insertId = this.insert(obj)

        var objs = this.filter({
                                   "id": insertId
                               }).all()
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
    "all": function () {
        var sql = "SELECT *"
        //        var fields = []
        //        for (var field in this._meta.fields) {
        //            fields.push(field)
        //        }

        //        sql += fields.join(',')
        sql += " FROM " + this._meta.tableName
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
            var obj = this.makeObject(item)
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
            if (field === '_model')
                continue
            if (field === 'save')
                continue
            if (field === 'id')
                continue

            if (idx > 0)
                sql += ","
            sql += field + " = " + this._convertToSqlType(obj[field]) + ""
            idx++
        }
        sql += this._defineWhereClause(this.filterConditions)

        var rs = this._meta.db.executeSql(sql)
        this.filterConditions = {}

        return rs.rowsAffected
    },
    "insert": function (obj) {
        var sql = "INSERT INTO " + this._meta.tableName + "("
        var fields = []
        var values = []
        for (var field in obj) {
            var value = obj[field]
            if (field === '_model' || field === 'save')
                continue
            if (field === 'id' && isNull(value))
                continue
            if (value === undefined) {
                continue
            }
            fields.push(field)
            if (value === null) {
                values.push('NULL')
            } else {
                values.push(this._convertToSqlType(value))
            }
        }
        sql += fields.join(', ')
        sql += ") VALUES (" + values.join(', ') + ")"

        var rs = this._meta.db.executeSql(sql)
        return rs.insertId
    },
    "remove": function (value) {
        if (value !== undefined) {
            this.filterConditions = {
                "id": value
            }
        }

        var sql = "DELETE FROM " + this._meta.tableName
        sql += this._defineWhereClause()
        var rs = this._meta.db.executeSql(sql)
        this.filterConditions = {}

        return rs.rowsAffected
    },
    "_typeof": function (value) {
        var l_type = typeof value

        // adjusting type based on object instanceof
        if (l_type === 'object') {
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
    "_convertToSqlType": function (value) {
        var l_type = this._typeof(value)

        if (l_type === 'boolean') {
            value = value ? 1 : 0
            l_type = 'number'
        }
        if (l_type === 'date') {
            if (isNaN(value)) {
                value = 'null'
            } else {
                value = value.toString()
                l_type = 'string'
            }
        }
        if (l_type === 'string') {
            value = "'" + value.replace("'", "''") + "'"
        }

        return value
    },
    "_convertFromSqlValue": function (value, definition) {
        if (!definition)
            return value
        if (!value)
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
                    || (l_desiredType === 'INTEGER') || (l_desiredType === 'FK')
                    || (l_desiredType === 'PK')) {
                value = Number(value)
            } else if ((l_desiredType === 'DATE')
                       || (l_desiredType === 'DATETIME')) {
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
            }
        }

        return value
    },
    "_defineWhereClause": function () {
        var sql = ''

        if (!isNull(this.filterConditions)
                && this.filterConditions.constructor === String) {
            sql = this.filterConditions
        } else {
            var idx = 0

            for (var cond in this.filterConditions) {
                if (idx > 0)
                    sql += " AND "
                var operator
                var newOperator = '='
                var field = cond
                var position
                if (cond.indexOf('__') > -1) {
                    var operands = cond.split('__')
                    field = operands[0]
                    operator = operands[1]

                    switch (operator) {
                    case 'gt':
                        newOperator = '>'
                        break
                    case 'ge':
                        newOperator = '>='
                        break
                    case 'lt':
                        newOperator = '<'
                        break
                    case 'le':
                        newOperator = '<='
                        break
                    case 'null':
                        if (this.filterConditions[cond])
                            newOperator = 'IS NULL'
                        else
                            newOperator = 'IS NOT NULL'
                        break
                    case 'like':
                        newOperator = 'LIKE'
                        position = 'BEGINEND'
                        break
                    case 'startswith':
                        newOperator = 'LIKE'
                        position = 'END'
                        break
                    case 'endswith':
                        newOperator = 'LIKE'
                        position = 'BEGIN'
                        break
                    }
                } else if (this.filterConditions[cond].constructor === Array) {
                    newOperator = 'IN'
                }

                sql += field + " " + newOperator + " "
                if (newOperator === 'LIKE') {
                    sql += "'"
                    if (position.indexOf('BEGIN') > -1) {
                        sql += "%"
                    }
                    sql += this.filterConditions[cond]
                    if (position.indexOf('END') > -1) {
                        sql += "%"
                    }
                    sql += "'"
                } else if (operator !== 'null') {
                    if (this.filterConditions[cond].constructor === String) {
                        sql += "'" + this.filterConditions[cond] + "'"
                    } else if (newOperator === 'IN') {
                        sql += "('" + this.filterConditions[cond].join(
                                    "','") + "')"
                    } else {
                        sql += this._convertToSqlType(
                                    this.filterConditions[cond])
                    }
                }
                idx++
            }
        }

        if (sql.length > 0) {
            sql = " WHERE " + sql
        }

        return sql
    },
    "makeObject": function (values) {
        var obj = new QMObject(this)
        for (var field in values) {
            var value = values[field]
            var idx2Dots = field.indexOf(':')
            if (idx2Dots > 0) {
                field = field.substring(0, idx2Dots)
            }

            if (field.startsWith('_') || field === 'save'
                    || !(field in this._meta.fields))
                continue

            value = this._convertFromSqlValue(value, this._meta.fields[field])

            if (!isNull(obj[field.toLowerCase()]) && isNull(value))
                continue

            obj[field.toLowerCase()] = value
        }
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

QMObject.prototype = {
    "save"//Functions for single object
    : function (forceInsert) {
        if (typeof forceInsert === 'undefined') {
            forceInsert = false
        }

        if (this.id && !forceInsert) {
            var l_rowsAffected = this._model.filter({
                                                        "id": this.id
                                                    }).update(this)
            if (l_rowsAffected > 0)
                return this
        }

        this.id = this._model.insert(this)
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
