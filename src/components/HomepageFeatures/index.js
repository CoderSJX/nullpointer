import React from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: '大量的好物收藏',
    Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
    description: (
      <>
       收集了大量优秀的设计网站、工具网站、技术文章，不管你是做开发，还是文书工作，亦或是日常生活，都能发现你想要的东西
      </>
    ),
  },
  {
    title: '丰富的个人经验总结',
    Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
    description: (
      <>
      包含了从<code>JavaScript</code>、<code>Vue</code>、<code>Java</code>、数据库、运维、测试等丰富的技术经验文章，可能正是你想解决的问题
      </>
    ),
  },
  {
    title: '全面的网络资源收集',
    Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
    description: (
      <>
        只有互联网上不存在的，没有我找不到的。各类电子书、视频、软件资源，我都可以找的到。
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
