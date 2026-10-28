import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CARD_W, CARD_H } from './config.js';

// Rigid body simulation in CGS units (cm, g, s) with a thin-plate aerodynamic model for cards:
// a falling card experiences normal pressure drag, lift at low angles of attack and a centre of
// pressure that moves toward the leading edge, which makes cards flutter, glide and tumble.

const RHO_AIR = 1.2e-3;          // g / cm³
const CARD_AREA = CARD_W * CARD_H;
const CARD_MASS = 1.75;          // g
export const PHYS_CARD_T = 0.06;  // collider thickness (cm)

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _t = new THREE.Vector3();
const _w = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3(), _ip = new THREE.Vector3();

export class Physics {
	async init() {
		await RAPIER.init();
		this.R = RAPIER;
		this.world = new RAPIER.World( { x: 0, y: -981, z: 0 } );
		this.world.timestep = 1 / 120;
		this.world.integrationParameters.numSolverIterations = 8;
		// stiffer contacts: with gravity in cm/s² the default 30 Hz contact spring sinks ~0.3 mm
		this.world.integrationParameters.contact_natural_frequency = 110;
		this.events = new RAPIER.EventQueue( true );
		this.entities = new Map(); // collider handle → entity
		this.list = new Set();
		this.acc = 0;
		this.timeScale = 1;
		this.onImpact = null;

		const ground = this.world.createRigidBody( RAPIER.RigidBodyDesc.fixed().setTranslation( 0, -5, 0 ) );
		this.world.createCollider( RAPIER.ColliderDesc.cuboid( 400, 5, 400 ).setFriction( 0.55 ).setRestitution( 0.12 ), ground );
	}

	addCard( entity, mesh, linvel, angvel ) {
		const R = this.R;
		const p = mesh.position, q = mesh.quaternion;
		const body = this.world.createRigidBody(
			R.RigidBodyDesc.dynamic()
				.setTranslation( p.x, p.y, p.z )
				.setRotation( { x: q.x, y: q.y, z: q.z, w: q.w } )
				.setLinvel( linvel.x, linvel.y, linvel.z )
				.setAngvel( { x: angvel.x, y: angvel.y, z: angvel.z } )
				.setCcdEnabled( true )
				.setLinearDamping( 0.02 )
				.setAngularDamping( 0.15 ),
		);
		const col = this.world.createCollider(
			R.ColliderDesc.cuboid( CARD_W / 2 - 0.05, CARD_H / 2 - 0.05, PHYS_CARD_T / 2 )
				.setMass( CARD_MASS )
				.setFriction( 0.42 )
				.setRestitution( 0.08 )
				.setActiveEvents( R.ActiveEvents.CONTACT_FORCE_EVENTS )
				.setContactForceEventThreshold( 900 ),
			body,
		);
		const rec = { entity, mesh, body, col, aero: true, area: CARD_AREA, chord: ( CARD_W + CARD_H ) / 2, lastImpact: 0 };
		this.entities.set( col.handle, rec );
		this.list.add( rec );
		entity.body = body;
		return rec;
	}

	addBox( entity, mesh, half, { mass = 10, friction = 0.6, restitution = 0.15, linvel, angvel, aero = false, area = 0 } = {} ) {
		const R = this.R;
		const p = mesh.position, q = mesh.quaternion;
		const desc = R.RigidBodyDesc.dynamic().setTranslation( p.x, p.y, p.z ).setRotation( { x: q.x, y: q.y, z: q.z, w: q.w } ).setCcdEnabled( true );
		if ( linvel ) desc.setLinvel( linvel.x, linvel.y, linvel.z );
		if ( angvel ) desc.setAngvel( { x: angvel.x, y: angvel.y, z: angvel.z } );
		desc.setAngularDamping( 0.3 );
		const body = this.world.createRigidBody( desc );
		const col = this.world.createCollider(
			R.ColliderDesc.cuboid( half.x, half.y, half.z ).setMass( mass ).setFriction( friction ).setRestitution( restitution )
				.setActiveEvents( R.ActiveEvents.CONTACT_FORCE_EVENTS ).setContactForceEventThreshold( 2000 ),
			body,
		);
		const rec = { entity, mesh, body, col, aero, area, chord: Math.max( half.x, half.y ), lastImpact: 0 };
		this.entities.set( col.handle, rec );
		this.list.add( rec );
		entity.body = body;
		return rec;
	}

	remove( entity ) {
		for ( const rec of this.list ) {
			if ( rec.entity !== entity ) continue;
			this.entities.delete( rec.col.handle );
			this.world.removeRigidBody( rec.body );
			this.list.delete( rec );
		}
		entity.body = null;
	}

	// returns world linear / angular velocity of an entity's body
	velocities( entity, lin, ang ) {
		const b = entity.body;
		if ( ! b ) return;
		const l = b.linvel(), a = b.angvel();
		lin.set( l.x, l.y, l.z ); ang.set( a.x, a.y, a.z );
	}

	applyAero( rec ) {
		const b = rec.body;
		if ( b.isSleeping() ) return;
		const lv = b.linvel(), av = b.angvel(), rot = b.rotation();
		_v.set( lv.x, lv.y, lv.z );
		_w.set( av.x, av.y, av.z );
		const speed = _v.length();
		b.resetForces( false );
		b.resetTorques( false );
		if ( speed < 1 && _w.lengthSq() < 0.5 ) return;
		_q.set( rot.x, rot.y, rot.z, rot.w );
		_n.set( 0, 0, 1 ).applyQuaternion( _q );
		const vn = _v.dot( _n );
		const sinA = Math.min( Math.abs( vn ) / Math.max( speed, 1e-6 ), 1 );
		const k = 0.5 * RHO_AIR * rec.area;
		// normal force coefficient: ~2π·α for small angles, saturating at ~1.2 for a plate broadside
		const cn = 1.25 * Math.tanh( 5.0 * sinA );
		const fn = - Math.sign( vn ) * k * cn * speed * speed * ( rec.aeroScale ?? 1 );
		_f.copy( _n ).multiplyScalar( fn );
		// skin friction along the plate
		_ip.copy( _v ).addScaledVector( _n, - vn );
		const vt = _ip.length();
		_f.addScaledVector( _ip, - k * 0.02 * vt * ( rec.aeroScale ?? 1 ) );
		b.addForce( { x: _f.x, y: _f.y, z: _f.z }, true );

		// centre of pressure ahead of the centre at low angles of attack → pitching moment
		if ( vt > 1e-3 ) {
			_r.copy( _ip ).multiplyScalar( 1 / vt ).multiplyScalar( 0.25 * rec.chord * ( 1 - sinA ) );
			_t.copy( _r ).cross( _n ).multiplyScalar( fn );
		} else _t.set( 0, 0, 0 );
		// rotational air damping (quadratic), weaker around the plate normal
		const wn = _w.dot( _n );
		_ip.copy( _w ).addScaledVector( _n, - wn );
		const cw = 0.9 * rec.area / CARD_AREA;
		_t.addScaledVector( _ip, - cw * _ip.length() );
		_t.addScaledVector( _n, - 0.04 * wn * Math.abs( wn ) - 0.6 * wn );
		b.addTorque( { x: _t.x, y: _t.y, z: _t.z }, true );
	}

	step( dt ) {
		this.acc += Math.min( dt, this.maxDt || 1 / 20 ) * this.timeScale;
		const h = this.world.timestep;
		let n = 0;
		while ( this.acc >= h && n < ( this.maxSteps || 8 ) ) {
			for ( const rec of this.list ) if ( rec.aero ) this.applyAero( rec );
			this.world.step( this.events );
			this.acc -= h;
			n ++;
			this.events.drainContactForceEvents( e => {
				const rec = this.entities.get( e.collider1() ) || this.entities.get( e.collider2() );
				if ( ! rec || ! this.onImpact ) return;
				const now = performance.now();
				if ( now - rec.lastImpact < 90 ) return;
				rec.lastImpact = now;
				rec.aeroScale = 1;
				this.onImpact( rec.entity, e.maxForceMagnitude() );
			} );
		}
		for ( const rec of this.list ) {
			const t = rec.body.translation(), r = rec.body.rotation();
			rec.mesh.position.set( t.x, t.y, t.z );
			rec.mesh.quaternion.set( r.x, r.y, r.z, r.w );
		}
	}

	isResting( entity ) {
		const b = entity.body;
		if ( ! b ) return true;
		if ( b.isSleeping() ) return true;
		const l = b.linvel(), a = b.angvel();
		return l.x * l.x + l.y * l.y + l.z * l.z < 4 && a.x * a.x + a.y * a.y + a.z * a.z < 0.3;
	}
}
