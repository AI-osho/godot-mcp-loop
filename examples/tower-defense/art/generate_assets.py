"""Original low-fi pixel assets; Pillow 13, no network or external artwork.
Coordinates are authored at one texel per world pixel (displayed 2x).
"""
import json, math, random, struct, wave
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets'
OUT.mkdir(parents=True,exist_ok=True)
P=json.loads((Path(__file__).parent/'palette.json').read_text())
def col(k): return P.get(k,k)
def rect(d,box,k): d.rectangle(box,fill=col(k))
def poly(d,pts,k): d.polygon(pts,fill=col(k))
def line(d,pts,k,w=1): d.line(pts,fill=col(k),width=w)
def image(size): return Image.new('RGBA',size,(0,0,0,0))
def save(im,name): im.save(OUT/(name+'.png'),optimize=False)
def tuft(d,x,y):
    line(d,[(x-3,y),(x-4,y-3),(x-2,y-1),(x,y-5),(x+1,y-1),(x+4,y-3),(x+2,y)],'grass_light')
def shrub(d,x,y,s=1):
    poly(d,[(x-9*s,y),(x-11*s,y-6*s),(x-6*s,y-7*s),(x-5*s,y-13*s),(x+2*s,y-12*s),(x+5*s,y-8*s),(x+10*s,y-7*s),(x+9*s,y)],'ink')
    poly(d,[(x-8*s,y-1*s),(x-9*s,y-5*s),(x-4*s,y-6*s),(x-3*s,y-11*s),(x+1*s,y-10*s),(x+4*s,y-6*s),(x+8*s,y-5*s),(x+7*s,y-1*s)],'grass')
    line(d,[(x-7*s,y-5*s),(x-4*s,y-5*s),(x-2*s,y-9*s),(x+1*s,y-9*s)],'leaf',s)
def lantern(d,x,y):
    line(d,[(x,y-9),(x+1,y-13),(x+4,y-14)],'wood_dark',2)
    poly(d,[(x-5,y-8),(x-3,y-10),(x+3,y-10),(x+5,y-7),(x+5,y-2),(x+2,y),(x-3,y),(x-5,y-3)],'amber')
    rect(d,(x-3,y-8,x+2,y-2),'gold'); rect(d,(x-2,y-7,x,y-3),'cream')
def rock(d,x,y):
    poly(d,[(x-5,y),(x-6,y-3),(x-3,y-7),(x+2,y-7),(x+5,y-3),(x+4,y)],'stone_dark')
    poly(d,[(x-4,y-3),(x-2,y-6),(x+1,y-6),(x+3,y-3)],'stone')
    line(d,[(x-3,y-4),(x-1,y-5),(x+1,y-5)],'stone_light')
# Actor sprites with different silhouettes, gait and shell markings.
for kind in ['beetle','runner','heavy']:
    sheet=image((64,20)); d=ImageDraw.Draw(sheet)
    for f in range(4):
        x=f*16; y=2
        rect(d,(x+4,17,x+12,18),'grass_dark')
        for side in [-1,1]:
            for i in range(3):
                yy=y+5+i*3; gait=(1 if f%2 else -1)*(1 if i%2 else -1)
                xx=x+(3 if side<0 else 12)
                line(d,[(xx,yy),(xx+side*2,yy+gait),(xx+side*3,yy+gait+1)],'ink')
        shell='amber' if kind=='beetle' else ('purple' if kind=='runner' else 'stone')
        shade='wood_dark' if kind=='beetle' else ('#665b82' if kind=='runner' else 'stone_dark')
        poly(d,[(x+4,y+3),(x+6,y+1),(x+10,y+1),(x+12,y+4),(x+13,y+11),(x+11,y+14),(x+5,y+14),(x+3,y+10)],'ink')
        poly(d,[(x+5,y+3),(x+7,y+2),(x+10,y+3),(x+11,y+5),(x+12,y+10),(x+10,y+12),(x+5,y+11),(x+4,y+7)],shell)
        poly(d,[(x+9,y+4),(x+11,y+6),(x+12,y+10),(x+10,y+12),(x+8,y+11),(x+8,y+5)],shade)
        line(d,[(x+7,y+3),(x+6,y+5),(x+5,y+7)],'gold' if kind=='beetle' else 'stone_light')
        rect(d,(x+5,y+11,x+11,y+14),'ink')
        rect(d,(x+5,y+12,x+6,y+12),'cream'); rect(d,(x+10,y+12,x+11,y+12),'cream')
        if kind=='runner':
            poly(d,[(x+3,y+5),(x,y+2),(x+1,y+8),(x+3,y+9)],'purple')
            poly(d,[(x+12,y+5),(x+15,y+2),(x+14,y+8),(x+12,y+9)],'purple')
        if kind=='heavy':
            line(d,[(x+3,y+4),(x+7,y+6),(x+12,y+4)],'stone_light')
            line(d,[(x+3,y+8),(x+7,y+10),(x+12,y+8)],'stone_light')
    save(sheet,kind)
# Two tower sheets: idle, recoil/active, recovery.
for kind in ['amber_tower','mist_tower']:
    sheet=image((84,36)); d=ImageDraw.Draw(sheet)
    for f in range(3):
        x=f*28; recoil=1 if f==1 else 0
        poly(d,[(x+4,31),(x+7,28),(x+22,28),(x+25,31),(x+22,34),(x+7,34)],'ink')
        rect(d,(x+7,28,x+22,31),'stone'); line(d,[(x+8,28),(x+20,28)],'stone_light')
        rect(d,(x+10,22,x+19,28),'wood_dark'); rect(d,(x+11,22,x+14,27),'wood')
        if kind=='amber_tower':
            poly(d,[(x+7,12+recoil),(x+9,9+recoil),(x+20,9+recoil),(x+22,12+recoil),(x+20,23),(x+9,23)],'ink')
            rect(d,(x+9,12+recoil,x+20,20),'amber'); rect(d,(x+11,12+recoil,x+17,19),'gold')
            rect(d,(x+12,13+recoil,x+14,17),'cream'); line(d,[(x+9,11+recoil),(x+9,21),(x+20,21),(x+20,11+recoil)],'wood_dark')
            poly(d,[(x+5,12+recoil),(x+8,9+recoil),(x+11,8+recoil),(x+14,3+recoil),(x+17,7+recoil),(x+20,8+recoil),(x+24,12+recoil)],'ink')
            poly(d,[(x+8,11+recoil),(x+12,8+recoil),(x+14,5+recoil),(x+18,9+recoil),(x+21,11+recoil)],'red')
            line(d,[(x+9,10+recoil),(x+12,8+recoil),(x+14,5+recoil)],'gold')
            rect(d,(x+13,0+recoil,x+15,3+recoil),'gold')
        else:
            rect(d,(x+8,9,x+10,25),'stone_dark'); rect(d,(x+18,9,x+20,25),'stone_dark')
            line(d,[(x+9,24),(x+9,9),(x+19,9),(x+19,24)],'blue',2)
            poly(d,[(x+4,10),(x+9,7),(x+14,2),(x+20,7),(x+24,10)],'ink')
            poly(d,[(x+7,9),(x+12,5),(x+15,4),(x+21,9)],'blue')
            line(d,[(x+8,8),(x+13,4),(x+15,4)],'ice')
            line(d,[(x+14,10),(x+14,13+recoil)],'cream')
            poly(d,[(x+12,12+recoil),(x+16,12+recoil),(x+18,18+recoil),(x+17,20+recoil),(x+11,20+recoil),(x+10,18+recoil)],'ice')
            rect(d,(x+12,15+recoil,x+13,18+recoil),'cream'); rect(d,(x+13,21+recoil,x+15,22+recoil),'gold')
        if f==1:
            line(d,[(x+1,7),(x+3,8)],'cream'); line(d,[(x+24,4),(x+26,2)],'gold' if kind=='amber_tower' else 'ice')
    save(sheet,kind)
# Seedhouse / base: carved timber, greenhouse windows and curling seed leaves.
base=image((40,46)); d=ImageDraw.Draw(base)
poly(d,[(2,40),(8,35),(32,35),(38,40),(32,44),(8,44)],'ink')
rect(d,(8,18,31,39),'wood_dark'); rect(d,(10,19,29,37),'wood')
rect(d,(12,22,27,34),'ink'); rect(d,(13,23,26,33),'gold')
rect(d,(15,24,19,31),'cream'); line(d,[(20,22),(20,34)],'wood_dark',2); line(d,[(12,28),(27,28)],'wood_dark')
poly(d,[(4,20),(7,15),(12,12),(16,7),(22,7),(27,12),(34,17),(36,20)],'ink')
poly(d,[(7,18),(14,12),(18,9),(22,10),(32,18)],'blue')
line(d,[(10,16),(18,10),(20,10)],'ice',2)
line(d,[(20,8),(21,3),(26,1)],'leaf',2); poly(d,[(20,4),(15,4),(12,1),(17,0),(21,2)],'mint')
rect(d,(8,36,31,39),'stone'); line(d,[(10,36),(28,36)],'stone_light')
lantern(d,4,31);lantern(d,36,31);save(base,'seedhouse')
# Fixed map, deliberately quiet detail around the readable winding path.
board=Image.new('RGBA',(360,260),col('grass_dark')); d=ImageDraw.Draw(board)
rect(d,(3,3,356,256),'ink');rect(d,(5,5,354,254),'grass')
# Border stones, not a repeated playfield grid.
for x in range(5,355,14):
    rect(d,(x,4,x+11,8),'stone_dark');line(d,[(x+1,4),(x+9,4)],'stone')
    rect(d,(x,252,x+11,256),'stone_dark')
for y in range(12,250,14):
    rect(d,(3,y,7,y+11),'stone_dark');rect(d,(352,y,356,y+11),'stone_dark')
path=[(10,48),(123,48),(123,167),(231,167),(231,92),(314,92),(314,221)]
line(d,path,'grass_dark',29);line(d,path,'soil_shadow',25);line(d,path,'soil',21);line(d,path,'soil_light',15)
# Edge cuts and stepping stones.
for x,y in [(31,48),(61,48),(91,48),(123,77),(123,108),(123,139),(154,167),(185,167),(216,167),(231,136),(231,108),(258,92),(286,92),(314,122),(314,153),(314,184),(314,211)]:
    poly(d,[(x-4,y-2),(x-2,y-4),(x+4,y-3),(x+5,y+1),(x+1,y+3),(x-4,y+2)],'soil')
    line(d,[(x-3,y-2),(x+2,y-3)],'cream')
# Rain-water pond, rows of lantern gourds and horticultural objects.
poly(d,[(21,185),(35,176),(71,179),(86,190),(81,216),(62,225),(29,221),(17,209)],'ink')
poly(d,[(22,188),(36,180),(69,182),(81,192),(77,213),(61,220),(31,217),(21,207)],'sky')
for x,y in [(30,191),(55,187),(43,207),(65,215)]:line(d,[(x,y),(x+9,y),(x+11,y-1)],'blue')
for x,y in [(30,179),(18,206),(78,220)]:tuft(d,x,y)
for y in [212,231]:
    for x in [154,174,194,214]:
        line(d,[(x-5,y),(x+5,y)],'soil_shadow',2);lantern(d,x,y)
# Tool bench and signpost.
rect(d,(178,32,207,36),'ink');rect(d,(181,26,205,31),'wood');rect(d,(182,34,184,40),'wood_dark');rect(d,(202,34,204,40),'wood_dark')
line(d,[(186,24),(191,29)],'stone_light',2);rect(d,(197,23,202,27),'blue')
rect(d,(15,34,17,55),'wood_dark');poly(d,[(11,32),(28,32),(31,36),(28,40),(11,40)],'wood');line(d,[(14,35),(24,35),(22,33)],'cream')
# Deliberately positioned shrubs, rocks and plant clusters away from pads/path.
for x,y,s in [(24,23,1),(60,24,1),(96,23,1),(157,26,1),(246,28,1),(328,29,1),(339,64,1),(42,100,1),(82,123,2),(39,154,1),(173,65,1),(190,110,1),(195,149,1),(259,203,1),(339,240,1),(107,240,1)]:shrub(d,x,y,s)
for x,y in [(33,135),(67,153),(104,211),(214,54),(280,232),(334,188),(278,164),(146,112)]:rock(d,x,y)
for x,y in [(18,73),(54,79),(100,31),(149,52),(168,172),(206,188),(250,68),(296,38),(333,113),(342,217),(103,186),(146,245)]:tuft(d,x,y)
# Pads correspond exactly to build spots in rules.
spots=[(73,81),(156,87),(156,137),(196,202),(265,137),(282,57),(284,196),(337,156)]
for i,(x,y) in enumerate(spots):
    poly(d,[(x-13,y-4),(x-8,y-9),(x+8,y-9),(x+13,y-4),(x+13,y+5),(x+8,y+10),(x-8,y+10),(x-13,y+5)],'ink')
    poly(d,[(x-11,y-3),(x-7,y-7),(x+7,y-7),(x+11,y-3),(x+11,y+4),(x+7,y+7),(x-7,y+7),(x-11,y+4)],'stone_dark')
    line(d,[(x-9,y-3),(x-6,y-5),(x+6,y-5),(x+9,y-3)],'stone_light')
    rect(d,(x-5,y+1,x+5,y+3),'stone')
    # Pillow's built-in bitmap lettering, not a proprietary font asset.
    d.text((x-3,y+11),chr(65+i),fill=col('cream'),font_size=8)
# Base rendered separately at runtime; orchard fence.
for x in range(292,340,6):
    rect(d,(x,230,x+2,245),'wood_dark');rect(d,(x,230,x+1,242),'wood')
line(d,[(290,237),(342,237)],'wood',2)
save(board,'board')
# Full original title vista, with large seedhouse and garden silhouettes.
title=Image.new('RGBA',(480,320),col('night'));d=ImageDraw.Draw(title)
rect(d,(0,48,479,162),'sky')
poly(d,[(0,135),(48,112),(82,124),(120,100),(172,126),(215,106),(260,122),(320,101),(380,128),(429,105),(479,119),(479,319),(0,319)],'grass_dark')
poly(d,[(0,173),(47,153),(118,172),(180,141),(252,162),(312,144),(370,170),(430,147),(480,168),(480,320),(0,320)],'grass')
poly(d,[(0,291),(109,267),(180,235),(154,220),(94,222),(68,210),(98,195),(161,185),(191,170),(183,160),(209,162),(216,173),(192,190),(124,207),(120,215),(170,218),(200,238),(176,259),(110,292),(91,319),(0,319)],'soil_shadow')
poly(d,[(0,296),(113,272),(188,239),(164,226),(99,229),(77,212),(100,200),(165,190),(198,172),(192,163),(206,166),(208,174),(185,189),(117,205),(110,216),(167,222),(192,239),(170,254),(106,288),(82,319),(0,319)],'soil')
# Moon and stars are authored stepped clusters.
poly(d,[(207,33),(211,29),(219,29),(223,33),(223,41),(219,45),(211,45),(207,41)],'cream');poly(d,[(218,29),(225,30),(225,40),(219,41),(216,38),(216,33)],'night')
for x,y in [(18,28),(82,37),(142,17),(258,57),(319,30),(377,51),(450,18)]:
    rect(d,(x,y,x+1,y+1),'stone_light')
for x,y,s in [(22,175,3),(76,151,2),(233,153,2),(300,164,2),(443,176,3),(31,237,2),(236,253,2),(348,284,3)]:shrub(d,x,y,s)
for x,y in [(33,167),(75,147),(235,146),(441,167),(225,246),(350,275),(15,240)]:lantern(d,x,y)
# Tall seedhouse is a separately authored reusable asset, nearest scaled.
title.alpha_composite(base.resize((120,138),Image.Resampling.NEAREST),(101,94))
for x in range(13,251,16):
    rect(d,(x,284,x+4,315),'wood_dark');rect(d,(x,284,x+2,311),'wood')
line(d,[(8,298),(263,298)],'wood',4)
# Hand-positioned glow clusters, not uniform texture noise.
for x,y in [(47,212),(66,232),(228,191),(246,208),(90,266),(318,221),(375,199)]:
    rect(d,(x-2,y-1,x+2,y+1),'leaf');rect(d,(x,y-1,x+1,y),'cream')
save(title,'title_vista')
# Projectile + coin/icon sheet; distinct amber ember and blue bell tear.
icons=image((48,16));d=ImageDraw.Draw(icons)
poly(d,[(2,10),(5,4),(9,2),(11,6),(10,10),(6,13)],'amber');rect(d,(5,6,8,10),'cream')
poly(d,[(21,1),(26,8),(26,11),(23,14),(19,14),(16,11),(16,8)],'blue');rect(d,(19,8,22,11),'ice')
poly(d,[(35,3),(41,3),(44,6),(44,11),(41,14),(35,14),(32,11),(32,6)],'amber');rect(d,(35,5,41,11),'gold');line(d,[(37,6),(37,10)],'cream')
save(icons,'icons')
# Deterministic original PCM synthesis, no sampled audio.
S=22050
sounds={
 'place':(.18,[(520,780,.0,.18)]), 'shot':(.09,[(900,250,0,.09)]),
 'mist':(.22,[(1260,680,0,.22),(1680,960,0,.17)]), 'kill':(.14,[(680,1300,0,.14)]),
 'base_hit':(.26,[(150,65,0,.26),(86,45,0,.24)]),
 'click':(.07,[(440,580,0,.07)]),
 'victory':(1.12,[(523,523,0,.30),(659,659,.22,.32),(784,784,.44,.32),(1047,1047,.68,.40)]),
 'defeat':(.90,[(392,330,0,.28),(294,247,.25,.30),(196,147,.52,.35)])}
for name,(duration,tones) in sounds.items():
    pcm=[]
    for n in range(int(S*duration)):
        t=n/S;v=0.
        for a,b,start,length in tones:
            u=t-start
            if 0<=u<length:
                env=min(1.,u/.006)*(1.-u/length)**1.8
                phase=2*math.pi*(a*u+(b-a)*u*u/(2*length))
                v+=.20*env*(math.sin(phase)+.15*math.sin(phase*2))
        pcm.append(round(max(-.85,min(.85,v))*32767))
    with wave.open(str(OUT/(name+'.wav')),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(S);w.writeframes(struct.pack('<'+'h'*len(pcm),*pcm))
manifest=[]
for p in sorted(OUT.iterdir()):
    if p.suffix=='.png':
        im=Image.open(p);manifest.append({'file':p.name,'size':list(im.size),'kind':'original_pixel_art'})
    elif p.suffix=='.wav':
        with wave.open(str(p)) as w:manifest.append({'file':p.name,'frames':w.getnframes(),'rate':w.getframerate(),'kind':'original_synth_pcm'})
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False))
