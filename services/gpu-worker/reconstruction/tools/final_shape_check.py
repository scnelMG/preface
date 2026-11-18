"""Evaluate the final geometry, never refit it. Local-only, no texture calculation.
Usage: python tools/final_shape_check.py work/<id> [--evaluate-only]
"""
import argparse, copy, hashlib, json, os, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'pipeline'))
from scan_to_model import LID_LM, OVAL_LM, accept_of, line_holdout_abs
import frame_check

read=lambda p:json.loads(p.read_text(encoding='utf8'))
sha=lambda p:hashlib.sha1(p.read_bytes()).hexdigest()[:12]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('work');ap.add_argument('--evaluate-only',action='store_true');ap.add_argument('--sparse');a=ap.parse_args()
    w=Path(a.work).resolve();m=w/'model';r=read(m/'report.json');run=read(w/'run_all.json') if (w/'run_all.json').exists() else {}
    if not r.get('shape_only'):ap.error('shape-only output required; use a new review id')
    ch=r['chosen'];fit=m/f'fit_{ch}.ply';before=sha(fit);poses=sha(m/'frame_poses.json');sp=a.sparse or run.get('stages',{}).get('lens',{}).get('sparse')
    if r.get('provenance',{}).get('fit_sha') != before:ap.error('report does not identify the current final mesh')
    if not sp:ap.error('--sparse or run_all lens stage required')
    env={**os.environ,'PYTHONUTF8':'1','PYTHONIOENCODING':'utf-8'}
    timings={}
    def call(script,args,quality=False):
        started=time.perf_counter()
        p=subprocess.run([sys.executable,str(ROOT/script),*map(str,args)],env=env,capture_output=True,text=True,encoding='utf8')
        timings[Path(script).stem]=round(time.perf_counter()-started,3)
        with (w/'final_shape_check.log').open('a',encoding='utf8') as f:f.write(script+'\n'+p.stdout+p.stderr)
        if p.returncode and not (quality and p.returncode==1):raise RuntimeError(script+' failed: '+p.stderr[-700:])
    ev=m/f'eval_{ch}_final.json'
    skip=LID_LM+OVAL_LM
    call('pipeline/frame_check.py',[fit,sp,w/'prep/images',ev,'--fit-json',m/f'fit_{ch}.fit.json','--poses-in',m/'frame_poses.json','--no-repair','--skip',','.join(map(str,skip))])
    call('tools/line_check.py',[w,'--mesh',fit,'--tag','final','--overlays','0','--sparse',sp])
    lines=read(m/'line_check_final.json')
    r['line_check']=lines.get('summary',{})
    hold=set((m/'holdout.txt').read_text().split());bands=frame_check.bands(str(ev),hold,use_after=False)
    original=r.get('eval',{}).get(ch,{})
    if original:r.setdefault('candidate_eval_before_final',{}).setdefault(ch,copy.deepcopy(original))   # none when the candidate evaluation was skipped (fixed choice)
    r.setdefault('eval',{})[ch]={**original,'holdout':bands,'line':lines.get('summary',{}),
                              'line_holdout_abs':line_holdout_abs(lines['per_frame']),
                              'training':None,'line_abs_signed_mean':None,
                              'holdout_photo_agreement':None,'evaluation_stage':'final surface'}
    r['accept']=accept_of(bands)
    assert before==sha(fit) and poses==sha(m/'frame_poses.json'),'evaluation changed geometry/cameras'
    r['final_validation']={'fit_sha':before,'poses_sha':poses,'holdout_sha':sha(m/'holdout.txt'),'eval':ev.name,
                           'line':'line_check_final.json','timing_sec':dict(timings),'skipped_landmarks':skip,'visual_approval':'pending user',
                           'photo_agreement':'not re-evaluated; candidate NCC retained separately'}
    (m/'report.json').write_text(json.dumps(r,ensure_ascii=False,indent=1),encoding='utf8')
    if not a.evaluate_only:
        call('tools/qa_check.py',[w],quality=True)
        if (m/'head.glb').exists():call('tools/glb_frames.py',[w,'--sparse',sp])
        q=read(m/'qa_check.json');run['qa']={k:q.get(k) for k in ['status','problems','warnings','notes','current']}
        run.setdefault('review',{})['visual_approval']='pending user'
        if q['status']=='FAIL' and run.get('overall')=='PASS':run['overall']='WARN'
        (w/'run_all.json').write_text(json.dumps(run,ensure_ascii=False,indent=1),encoding='utf8')
    print(json.dumps({'id':w.name,'fit_sha':before,'holdout':bands,'line':r['eval'][ch]['line_holdout_abs'],'unchanged_geometry':True}))
if __name__=='__main__':main()
