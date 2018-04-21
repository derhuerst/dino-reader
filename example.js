'use strict'

const path = require('path')
const fs = require('fs')

const createReader = require('.')
const readCsv = require('./read-csv')
const mergeStations = require('./merge-stations')

const base = path.join(__dirname, 'vrr-2018-04-18')
const readFile = file => readCsv(path.join(base, file))

const reader = createReader(readFile)

reader.readSchedules((err, travelTimes) => {
	if (err) {
		console.error(err)
		return process.exitCode = 1
	}

	// todo
	const foo = Object.assign({}, travelTimes[Object.keys(travelTimes)[0]])
	foo.starts = foo.starts.sort().slice(0, 50).map(t => new Date(t * 1000))
	console.error(require('util').inspect(foo, {depth: null}))
})
