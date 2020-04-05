'use strict';
let $ = a => document.querySelector(a);

/*
 * Resync video to stream
 * Seeks to max(start, current) in the latest buffered section
 * Could call this -say- every three seconds, or onstalled
 */
let catchup = (video) =>
    {
	/// if (video.readyState == 4) return; /* check is playing, readyState is not the way to do that */
    var m = []; for(let i = 0; i < video.buffered.length; ++i){
	let s = video.buffered.start(i)
	let e = video.buffered.end(i);
	if (e > video.currentTime)
	    m.push([(s > video.currentTime? s : video.currentTime), e]); }
    m.sort((a,b) => b[1] - a[1]);
	if (m.length) {
	    console.log('resuming play!!!!');
	video.currentTime = m[0][0];
	video.play();
    } else {
	console.log('no playable range yet');
    }
};
function
save(video)
{
    video.addEventListener(
	'canplay',
	e => {
	    video.currentTimestamp = e.timeStamp;
	    video.play()}, {passive:true});
    video.addEventListener('progress', e => {
	//console.log('progress',video,e);
	// e.timeStamp may also be useful?
	catchup(video);
    }, {passive:true});
//    video.addEventListener('stalled', e => {
}

let blob_e;
let streams;
let vid;
let msrc;
let hush_camera_handle;
let chunks = [];

const HUSH_CODEC = 'video/webm;codecs=vp8';

/** Minimal subset WebM decoder **/

/*
 * Counters number of leading bits
 */
function
webm_octetwidth(u)
{
    let fst = u[0];
    let len = 1;
    while ((fst <<= 1) & 0x80) len++;
    return len;
}

function
webm_vint(u)
{
    console.log('subarray of', u, webm_octetwidth(u));
    return [
	u.subarray(0, webm_octetwidth(u)),
     u.subarray(webm_octetwidth(u),-1)
    ];
}

/****/
let latest = 0 ;
async function
please_encrypt(blob_event)
{
    //console.log('got blob event', blob_event);
    blob_e = blob_event;
    //vid.activeBuffers[0].appendBuffer(plaintext)
    let chunk = new Uint8Array(await blob_event.data.arrayBuffer());
    chunks.push(chunk);
    //console.log(chunk);
    //console.log('octet',webm_octetwidth(chunk));
    //console.log('first tag', webm_vint(chunk));

    //console.log('vid.msrc', vid.msrc);

    if ((chunks.length > 2 && ((parseInt(chunks.length / 10)) % 3 > 0)
	)
	|| vid.msrc.readyState == 'ended') {
	'skip this';
    } else {
	function doappend()
	{
	    if (vid.msrc.sourceBuffers[0]) {
		if (blob_event.timecode > latest) {
		    latest = blob_event.timecode;
		    console.log('adding', vid.msrc.readyState, blob_event.timecode);
		    vid.msrc.sourceBuffers[0].appendBuffer(chunk);
		} else {
		    console.log('ttiii\ni\nh\ns\nsn\ns');
		}
	    } else {
		console.log('for some\n\nx\n\nx\n\n\nx fucking reason no buffer');
	    }
	}
	if (vid.msrc.updating) {
	    vid.msrc.addEventListener(
		'updateend',
		e => { doappend(); },
		{once:true,passive:true}
	    );
	} else {
	    doappend();
	}
    }

	//vid.msrc.sourceBuffers[0].appendBuffer(chunk);

	//hush_camera_handle.stop();
	//let b = new Blob(chunks, {type: HUSH_CODEC});
	//let url = URL.createObjectURL(b);
	//let a = document.createElement('a');
	//a.href = url;
	//a.download ='test.webm';
	//document.body.appendChild(a);
	//a.click();
//    }
}

async function
camera_works(s)
{
    streams = s;
    hush_camera_handle = new MediaRecorder(s, {codec: HUSH_CODEC});
    //hush_camera_handle.mode = 'sequence';
    hush_camera_handle.ondataavailable = please_encrypt;
    hush_camera_handle.start(2000); /* TODO sample every n milliseconds */

}

function attach_new_mediasource(video)
{
    video.msrc = new MediaSource();
    video.msrc.mode = 'sequence';
    video.msrc.addEventListener(
	'sourceopen',
	e => { console.log('sourceopen', e);
	       let sb = video.msrc.addSourceBuffer(HUSH_CODEC);
	     },
	{passive:true});
    video.msrc.addEventListener(
	'sourceend',
	e => {console.log('sourceend', e);
	     },
	{passive:true});
    video.msrc.addEventListener(
	'error',
	e => {
	    console.log('media source errored, reattaching', video, e);
	    attach_new_mediasource(video);
	}, {passive:true});
}

async function
myonload
()
{
    vid = document.createElement('video');
    vid.setAttribute('muted', true);
    vid.setAttribute('preload', '0.4');
    //vid.setAttribute('poster', './no-video.png');
    //vid.playbackRate = 0.5; /* prevent running out of buffer */
    document.body.appendChild(vid);
    vid.addEventListener(
	'error',
	e => {
	    console.log('video failed');
	});
    attach_new_mediasource(vid);
    vid.src = URL.createObjectURL(vid.msrc);
    save(vid);

    let constraints = {
	video: {
	    codec: HUSH_CODEC,
	    frameRate: { ideal: 20, max: 25, } /* or just video:true*/
	    // facingMode: 'user' // use selfie-cam, !shoot-my-swimming-pool-cam
	},
	/* audio: {
	   noiseSuppression: true,
	   echoCancellation: true,
	   // sampleRate: 99999, /// Hz
	   //latency: 99.99, /// seconds
	}
	*/
    }
  var m = navigator.getUserMedia(
      constraints,
      camera_works,
      e=>console.log('navigator.getUserMedia err:',e)
  );


}
window.addEventListener('load', myonload);
