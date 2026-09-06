"""Regenerate README figures from committed evidence. Requires matplotlib."""
from pathlib import Path
import json
import re
import statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'figures'
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.labelcolor':'#334155','text.color':'#172033','svg.fonttype':'none','savefig.facecolor':'white'})
BLUE, GRAY, AMBER = '#344a86', '#8b96a8', '#b77722'
def save(fig, name):
    fig.savefig(OUT / f'{name}.svg', bbox_inches='tight')
    fig.savefig(OUT / f'{name}.png', dpi=180, bbox_inches='tight')
    plt.close(fig)

data=json.loads((ROOT/'docs/ABLATION_EVIDENCE.json').read_text())
arms=[[r for r in data['runs'] if r['useMemory']==m] for m in [True,False]]
fig,axes=plt.subplots(1,4,figsize=(13,3.8))
fig.suptitle('Task-memory ablation: one fixed writing task, three runs per arm',x=.05,ha='left',fontsize=14,fontweight='bold')
pass_counts=[sum(r['passed'] for r in group) for group in arms]
axes[0].bar([0,1],pass_counts,color=[BLUE,GRAY],width=.55)
axes[0].set_ylim(0,3.6);axes[0].set_yticks([0,1,2,3]);axes[0].set_ylabel('Completed runs');axes[0].set_title('Completion')
for i,n in enumerate(pass_counts): axes[0].text(i,n+.12,f'{n}/{len(arms[i])}',ha='center',fontweight='bold')
for ax,metric,title,label in [(axes[1],'attempts','Attempts','Attempts per run'),(axes[2],'tokens','Reported tokens','Thousands of tokens'),(axes[3],'costUsd','Estimated model cost','USD per run')]:
    values=[[((r['inputTokens']+r['outputTokens'])/1000 if metric=='tokens' else r[metric]) for r in group] for group in arms]
    for i,vals in enumerate(values):
        offsets=[i + .18 * (j / max(1, len(vals)-1) - .5) for j in range(len(vals))]
        ax.scatter(offsets,vals,c=[BLUE if i==0 else GRAY],s=40,zorder=3)
        median=statistics.median(vals)
        ax.plot([i-.25,i+.25],[median,median],color=BLUE if i==0 else GRAY,lw=2)
    ax.set_title(title);ax.set_ylabel(label);ax.set_ylim(bottom=0)
for ax in axes:
    ax.set_xticks([0,1],['Memory on','Memory off']);ax.set_xlim(-.55,1.55);ax.grid(axis='y',alpha=.15);ax.set_axisbelow(True)
fig.text(.05,.015,'Dots show individual runs; horizontal marks show medians. No significance claim. Memory-on cost is higher despite fewer median tokens.',fontsize=9,color='#536174')
fig.tight_layout(rect=[0,.09,1,.9]);save(fig,'memory-ablation')

def word_checks(filename):
    evidence=json.loads((ROOT/'docs'/filename).read_text())
    checks=[next(c for c in a['checks'] if c['criterionId']=='crit_word_count') for a in evidence['attempts']]
    parsed=[re.search(r'Deterministic check: (\d+) whitespace-separated.*expected (\d+)[–-](\d+)',c['rationale']) for c in checks]
    if not all(parsed):
        raise ValueError(f'Unrecognized recorded word-count evidence in {filename}')
    bounds={(int(m[2]),int(m[3])) for m in parsed}
    if len(bounds)!=1:
        raise ValueError('Writing chart requires a single frozen word-count interval')
    return [int(m[1]) for m in parsed],bounds.pop()

initial,interval=word_checks('LIVE_RUN_EVIDENCE.json')
repeat,repeat_interval=word_checks('REPEAT_RUN_EVIDENCE.json')
if interval!=repeat_interval or len(initial)!=2 or len(repeat)!=2:
    raise ValueError('Writing comparison requires two attempts per run and matched intervals')
fig,ax=plt.subplots(figsize=(10,3.8))
ax.axhspan(*interval,color='#e9edf5',label=f'Required interval: {interval[0]}–{interval[1]} words')
for x,vals,label,color in [([0,1],initial,'Initial live run',BLUE),([2.5,3.5],repeat,'Later run with memory',AMBER)]:
    ax.plot(x,vals,color=color,marker='o',markersize=7,lw=2,label=label)
    for a,b in zip(x,vals): ax.annotate(str(b),(a,b),xytext=(0,10 if b>=160 else -18),textcoords='offset points',ha='center',fontweight='bold')
ax.set_xticks([0,1,2.5,3.5],['Initial\nattempt 1','Initial\nattempt 2','Repeat\nattempt 1','Repeat\nattempt 2'])
ax.set_ylim(140,225);ax.set_ylabel('Whitespace-separated words');ax.set_title('Repair succeeds in both runs; stored memory does not eliminate the next failure',loc='left',pad=15,fontweight='bold')
ax.legend(loc='upper left',frameon=False,ncol=1,fontsize=9);ax.grid(axis='y',alpha=.15)
fig.tight_layout();save(fig,'writing-repair')

fixture=next(f for f in json.loads((ROOT/'lib/workbench/finance-demos.json').read_text()) if f['id']=='cash-forecast')
rows=[line.split('\t') for line in fixture['input'].splitlines()]
flows=[r for r in rows if r[0] in ['1','2','3','4']]
settings={r[0]:float(r[1]) for r in rows if r[0] in ['Opening cash USD','Operating buffer USD','Week 2 collection rate']}
opening=settings['Opening cash USD'];buffer=settings['Operating buffer USD']
receipts=[float(r[1]) for r in flows];payments=[float(r[2]) for r in flows]
delayed=receipts[1]*(1-settings['Week 2 collection rate'])
down_receipts=receipts.copy();down_receipts[1]-=delayed;down_receipts[3]+=delayed
def balances(inflows):
    out=[opening]
    for inflow,payment in zip(inflows,payments):out.append(out[-1]+inflow-payment)
    return out
weeks=[0,1,2,3,4];base=balances(receipts);down=balances(down_receipts)
if base!=[opening]+[float(r[4]) for r in flows]:
    raise ValueError('Calculated base cash differs from the fixture saved values')
fig,ax=plt.subplots(figsize=(9,4))
ax.plot(weeks,base,color=BLUE,marker='o',label='Base collections')
ax.plot(weeks,down,color=AMBER,marker='s',label='Half of week 2 receipts deferred to week 4')
ax.axhline(buffer,color=GRAY,ls='--',label=f'Minimum operating buffer: USD {buffer:,.0f}')
ax.set_xticks(weeks,['Opening','Week 1','Week 2','Week 3','Week 4']);ax.set_ylabel('Closing cash (USD)');ax.set_ylim(-250,5600)
ax.annotate('First buffer breach',(2,1000),xytext=(1.5,400),arrowprops={'arrowstyle':'-','color':AMBER},fontsize=9)
ax.annotate('USD 2,000 needed\nto restore buffer',(3,0),xytext=(3.05,650),arrowprops={'arrowstyle':'-','color':AMBER},fontsize=9)
ax.set_title('Cash-forecast demo: timing changes liquidity, not total receipts',loc='left',fontweight='bold',pad=14)
ax.legend(loc='upper right',frameon=False,fontsize=8);ax.grid(axis='y',alpha=.15)
fig.text(.08,.015,'Synthetic fixture. Curves show hand-calculated expected balances, not repeated agent performance.',fontsize=9,color='#536174')
fig.tight_layout(rect=[0,.06,1,1]);save(fig,'cash-scenario')
print('Rendered three evidence figures as SVG and PNG.')
