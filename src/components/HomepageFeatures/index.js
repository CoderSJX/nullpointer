import React from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: '广泛的好物收藏',
    Svg: require('@site/static/img/undraw_firmware_re_fgdy.svg').default,
    description: (
        <>
          收录了一系列优秀的设计资源、实用工具及技术文章，无论你从事开发工作、文档撰写，还是日常生活中遇到问题，都能在此找到有价值的信息
        </>
    ),
  },
  {
    title: '扎实的经验分享',
    Svg: require('@site/static/img/undraw_engineering_team_a7n2.svg').default,
    description: (
        <>
          提供涵盖<code>JavaScript</code>、<code>Vue</code>、<code>Java</code>、数据库、运维、测试等多个领域的实践经验，或许能为你在解决问题时提供参考
        </>
    ),
  },
  {
    title: '全面的网络资源索引',
    Svg: require('@site/static/img/undraw_drag_re_shc0.svg').default,
    description: (
        <>
          力求覆盖广泛的网络资源，包括电子书、教学视频以及各类实用软件，力求满足用户多样化的查找需求
        </>
    ),
  },
];

function Feature({Svg, title, description}) {
  return (
      <div className={clsx('col col--4')}>
        <div className="text--center">
          <Svg className={styles.featureSvg} role="img" />
        </div>
        <div className="text--center padding-horiz--md">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
  );
}

export default function HomepageFeatures() {
  return (
      <section className={styles.features}>
        <div className="container">
          <div className="row">
            {FeatureList.map((props, idx) => (
                <Feature key={idx} {...props} />
            ))}
          </div>
        </div>
      </section>
  );
}
