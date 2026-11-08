//! Offline speaker clustering of one track (spec 0101): average-linkage
//! agglomeration over cosine distance, then clusters with little speech join
//! the most similar large one. It replaces first-seen leader clustering,
//! which split each person into dozens of identities on short turns.

pub(super) struct Params {
    /// Merge while the average cosine distance stays at or below this.
    pub distance: f32,
    /// Clusters with less speech than this are not identities of their own.
    pub min_cluster_ms: u64,
    /// A small cluster's turn joins a large voice within this distance of
    /// its centroid; farther turns stay unknown.
    pub reassign_distance: f32,
}

/// Cluster index per vector (dense, in order of first appearance), or `None`
/// when a vector of a small cluster resembles no large cluster. Vectors must
/// be L2-normalized.
pub(super) fn cluster(
    vectors: &[Vec<f32>],
    durations_ms: &[u64],
    p: &Params,
) -> Vec<Option<usize>> {
    let n = vectors.len();
    if n == 0 {
        return Vec::new();
    }
    let dot = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
    let mut parent: Vec<usize> = (0..n).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    // Average linkage has no inversions, so applying only the merges at or
    // below the threshold is exactly the dendrogram cut.
    for (a, b, d) in average_linkage(vectors) {
        if d <= p.distance {
            let (ra, rb) = (root(&mut parent, a), root(&mut parent, b));
            parent[rb] = ra;
        }
    }
    let roots: Vec<usize> = (0..n).map(|i| root(&mut parent, i)).collect();
    let mut speech = vec![0u64; n];
    for (i, r) in roots.iter().enumerate() {
        speech[*r] += durations_ms[i];
    }
    let largest = (0..n).max_by_key(|&r| speech[r]).unwrap_or(0);
    let large = |r: usize| speech[r] >= p.min_cluster_ms || r == largest;
    let mut centroids: Vec<(usize, Vec<f32>)> = Vec::new();
    for (i, r) in roots.iter().enumerate() {
        if !large(*r) {
            continue;
        }
        match centroids.iter_mut().find(|(c, _)| c == r) {
            Some((_, sum)) => sum.iter_mut().zip(&vectors[i]).for_each(|(s, v)| *s += v),
            None => centroids.push((*r, vectors[i].clone())),
        }
    }
    for (_, sum) in &mut centroids {
        let norm = dot(sum, sum).sqrt().max(f32::EPSILON);
        sum.iter_mut().for_each(|v| *v /= norm);
    }
    // `centroids` is in order of first appearance, so its index is the label.
    roots
        .iter()
        .enumerate()
        .map(|(i, r)| {
            if large(*r) {
                return centroids.iter().position(|(c, _)| c == r);
            }
            centroids
                .iter()
                .enumerate()
                .map(|(k, (_, c))| (k, dot(c, &vectors[i])))
                .filter(|(_, s)| 1.0 - s <= p.reassign_distance)
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(k, _)| k)
        })
        .collect()
}

/// Every merge `(kept, absorbed, distance)` of the full dendrogram, by the
/// nearest-neighbour chain: O(n²) time over an n×n distance matrix.
fn average_linkage(vectors: &[Vec<f32>]) -> Vec<(usize, usize, f32)> {
    let n = vectors.len();
    let mut d = vec![0f32; n * n];
    for i in 0..n {
        for j in i + 1..n {
            let s: f32 = vectors[i].iter().zip(&vectors[j]).map(|(a, b)| a * b).sum();
            d[i * n + j] = 1.0 - s;
            d[j * n + i] = 1.0 - s;
        }
    }
    let mut active = vec![true; n];
    let mut size = vec![1f32; n];
    let mut chain: Vec<usize> = Vec::new();
    let mut merges = Vec::with_capacity(n.saturating_sub(1));
    let mut remaining = n;
    while remaining > 1 {
        if chain.is_empty() {
            chain.push(active.iter().position(|a| *a).unwrap());
        }
        let a = *chain.last().unwrap();
        let previous = chain.len().checked_sub(2).map(|i| chain[i]);
        // Ties prefer the previous link, which guarantees termination.
        let (mut best, mut best_d) =
            previous.map_or((usize::MAX, f32::INFINITY), |p| (p, d[a * n + p]));
        for k in 0..n {
            if active[k] && k != a && d[a * n + k] < best_d {
                (best, best_d) = (k, d[a * n + k]);
            }
        }
        if Some(best) != previous {
            chain.push(best);
            continue;
        }
        chain.truncate(chain.len() - 2);
        merges.push((a, best, best_d));
        for k in 0..n {
            if active[k] && k != a && k != best {
                let v = (size[a] * d[a * n + k] + size[best] * d[best * n + k])
                    / (size[a] + size[best]);
                d[a * n + k] = v;
                d[k * n + a] = v;
            }
        }
        size[a] += size[best];
        active[best] = false;
        remaining -= 1;
    }
    merges
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(angle_degrees: f32) -> Vec<f32> {
        let r = angle_degrees.to_radians();
        vec![r.cos(), r.sin(), 0.0]
    }
    const P: Params = Params {
        distance: 0.3,
        min_cluster_ms: 10_000,
        reassign_distance: 0.5,
    };

    #[test]
    fn groups_noisy_turns_of_the_same_voice_and_keeps_voices_apart() {
        // Two voices 90° apart; turns of each vary by up to 30° (cosine 0.87).
        let vectors: Vec<_> = [0.0, 25.0, -20.0, 90.0, 5.0, 110.0, 70.0, 30.0]
            .iter()
            .map(|a| unit(*a))
            .collect();
        let labels = cluster(&vectors, &[5_000; 8], &P);
        assert_eq!(
            labels,
            [0, 0, 0, 1, 0, 1, 1, 0].map(Some).to_vec(),
            "first voice is label 0 because it appears first"
        );
    }

    #[test]
    fn a_short_cluster_joins_the_nearest_large_voice_or_stays_unknown() {
        let mut vectors: Vec<_> = (0..4).map(|_| unit(0.0)).collect();
        vectors.push(unit(55.0)); // 2 s, too far to merge, close enough to join
        vectors.push(vec![0.0, 0.0, 1.0]); // 2 s, unlike anyone
        let durations = [5_000, 5_000, 5_000, 5_000, 2_000, 2_000];
        let labels = cluster(&vectors, &durations, &P);
        assert_eq!(labels, [Some(0), Some(0), Some(0), Some(0), Some(0), None]);
    }

    #[test]
    fn a_short_meeting_keeps_its_largest_voice() {
        assert_eq!(cluster(&[unit(0.0)], &[3_000], &P), [Some(0)]);
        assert!(cluster(&[], &[], &P).is_empty());
    }

    #[test]
    fn average_linkage_merges_the_closest_pair_first() {
        let vectors = [unit(0.0), unit(10.0), unit(80.0)];
        let merges = average_linkage(&vectors);
        assert_eq!(merges.len(), 2);
        let (a, b, d) = merges[0];
        assert_eq!((a.min(b), a.max(b)), (0, 1));
        assert!((d - (1.0 - 10f32.to_radians().cos())).abs() < 1e-6);
        assert!(merges[1].2 > d);
    }
}
