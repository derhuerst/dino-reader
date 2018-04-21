'use strict'

const {DateTime} = require('luxon')
const Bitfield = require('bitfield')
const {Writable} = require('stream')

const mergeStations = require('./merge-stations')

const parseCalendar = (days, from, until) => {
	days = new Bitfield(Buffer.from(days, 'hex'))
	const res = []

	until = DateTime.fromISO(until)
	let d = DateTime.fromISO(from)
	const startMonth = d.month
	while (d < until) {
		const i = (d.month - startMonth) * 32 + (32 - d.day)
		res.push(d / 1000 | 0)
		d = d.plus({days: 1})
	}

	return res
}

const reduce = (acc, reducer, stream, cb) => {
	const write = (row, _, cb) => {
		reducer(acc, row, cb)
	}

	const out = new Writable({objectMode: true, write})
	stream.pipe(out)

	let done = false
	out
	.once('error', (err) => {
		out.destroy(err)
		if (done) return
		done = true
		cb(err)
	})
	.once('finish', () => {
		if (done) return
		done = true
		cb(null, acc)
	})
}

const readRestrictions = (readFile, done) => {
	const writeRestriction = (restrictions, row, cb) => {
		const id = row.RESTRICTION.trim()
		restrictions[id] = {
			id,
			name: row.RESTRICT_TEXT1.trim(),
			days: parseCalendar(
				row.RESTRICTION_DAYS.trim(),
				row.DATE_FROM.trim(),
				row.DATE_UNTIL.trim()
			)
		}
		cb()
	}

	reduce(
		Object.create(null),
		writeRestriction,
		readFile('service_restriction.din'),
		done
	)
}

const readRoutes = (readFile, done) => {
	const writeRoute = (routes, row, cb) => {
		const id = row.LINE_NR.trim() + '-' + row.STR_LINE_VAR.trim()
		routes[id] = {
			id,
			name: row.LINE_NAME.trim(),
			// todo: map MOT_NO/TMOT_NO to FPTF modes
			stops: [] // filled later
		}
		cb()
	}

	reduce(
		Object.create(null),
		writeRoute,
		readFile('rec_lin_ber.din'),
		done
	)
}

const readRouteStops = (routes, readFile, done) => {
	const writeRouteStop = (routes, row, cb) => {
		const id = row.LINE_NR.trim() + '-' + row.STR_LINE_VAR.trim()
		const route = routes[id]
		if (!route) return cb(new Error('unknown id ' + id))
		route.stops.push({
			i: parseInt(row.LINE_CONSEC_NR),
			id: row.STOP_NR.trim(),
			distanceTravelled: parseInt(row.LENGTH)
			// todo: STOP_TYPE_NR, STOPPING_POINT_NR, STOPPING_POINT_TYPE
		})
		cb()
	}

	reduce(
		routes,
		writeRouteStop,
		readFile('lid_course.din'),
		done
	)
}

const createReader = (readFile, done) => {
	readRestrictions(readFile, (err, restrictions) => {
		if (err) return done(err)

		readRoutes(readFile, (err, routes) => {
			if (err) return done(err)
			readRouteStops(routes, readFile, (err, routes) => {
				if (err) return done(err)

				// todo
			})
		})
	})

	// mergeStations(
	// 	readFile('rec_stop.din'),
	// 	readFile('rec_stopping_points.din'),
	// 	done
	// )
}

module.exports = createReader
